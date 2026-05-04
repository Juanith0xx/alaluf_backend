const express = require('express');
const router = express.Router();
const axios = require('axios');

// Configuración de Axios: validateStatus permite que el código siga ejecutándose en 404
const alalufAxios = axios.create({
    headers: {
        'X-API-KEY': process.env.ALALUF_API_KEY,
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    },
    timeout: 30000,
    validateStatus: (status) => status < 500 
});

const BASE_URL_ALALUF = "https://alaluf.cl";
const SISTEMA_URL_ALALUF = "https://sistema.alaluf.com"; 

const obtenerCoordenadas = async (direccion) => {
    const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN;
    if (!token) return null;

    try {
        const query = encodeURIComponent(direccion);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1&country=cl`;
        const resp = await axios.get(url, { timeout: 5000 });

        if (resp.data.features && resp.data.features.length > 0) {
            const [lng, lat] = resp.data.features[0].center;
            return { lat, lng };
        }
    } catch (error) {
        console.error(`❌ [GEOCODE ERROR]: ${direccion} - ${error.message}`);
    }
    return null;
};

const mapearPropiedad = (prop) => {
    let fotosRaw = prop.fotos || prop.foto || prop.foto_portada || prop.imagen || [];
    if (typeof fotosRaw === 'string' && fotosRaw.length > 0) fotosRaw = [fotosRaw];

    const imagenesProcesadas = Array.isArray(fotosRaw) 
        ? fotosRaw.map(f => {
            if (!f || typeof f !== 'string') return null;
            const link = f.trim();
            if (link.startsWith('http')) return link;
            if (link.startsWith('/nuevo')) return `${SISTEMA_URL_ALALUF}${link}`;
            return `${BASE_URL_ALALUF}${link.startsWith('/') ? link : '/' + link}`;
        }).filter(f => f !== null)
        : [];

    const lat = parseFloat(prop.latitud);
    const lng = parseFloat(prop.longitud);

    return {
        id: prop.id_propiedad,          
        codigo: prop.codigo_interno,    
        titulo: prop.desc_tipo || "Propiedad",
        operacion: prop.desc_obj || "Venta / Arriendo",
        ubicacion: {
            comuna: prop.com_nombre || "Sin Comuna",
            sector: prop.sector_cercano || "Sin Sector",
            region: prop.region || "Metropolitana",
            direccion: prop.direccion || "" 
        },
        coords: {
            lat: lat && lat !== 0 ? lat : null,
            lng: lng && lng !== 0 ? lng : null
        },
        precios: {
            venta: { valor: prop.valor_venta && prop.valor_venta !== "0" ? prop.valor_venta : null, moneda: prop.moneda_venta || "UF" },
            arriendo: { valor: prop.valor_arriendo && prop.valor_arriendo !== "0" ? prop.valor_arriendo : null, moneda: prop.moneda_arriendo || "UF/m2" }
        },
        detalles: {
            superficie: parseFloat(prop.m2_utiles || prop.m2_construidos || prop.m2_terreno) || 0,
            banos: parseInt(prop.banos) || 0,
            dormitorios: parseInt(prop.dormitorios) || 0,
            privados: parseInt(prop.privados) || 0,
            estacionamientos: parseInt(prop.estacionamientos) || 0,
            descripcion: prop.caracteristicas_internet || ""
        },
        imagenes: imagenesProcesadas
    };
};

// --- RUTAS ---

router.get('/buscar', async (req, res) => {
    try {
        const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, { params: req.query });
        const rawDataArray = response.data?.data || [];

        const propiedadesProcesadas = await Promise.all(rawDataArray.map(async (prop) => {
            let mapeada = mapearPropiedad(prop);
            if (!mapeada.coords.lat || !mapeada.coords.lng) {
                const calle = (prop.direccion || "").trim();
                const comuna = (prop.com_nombre || "").trim();
                if (calle.length > 3) {
                    const coords = await obtenerCoordenadas(`${calle}, ${comuna}, Chile`);
                    if (coords) mapeada.coords = coords;
                }
            }
            return mapeada;
        }));
        res.json(propiedadesProcesadas);
    } catch (error) {
        res.status(500).json({ error: "Error en el servidor de búsqueda" });
    }
});

/**
 * RUTA MEJORADA: Soporta ID (447) y Código (18870)
 */
router.get('/:id', async (req, res) => {
    const term = req.params.id;
    let rawData = null;

    try {
        // Intento 1: Ficha directa
        const responseDirecta = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
            params: { id_propiedad: term }
        });
        
        if (responseDirecta.status === 200 && responseDirecta.data?.data) {
            rawData = responseDirecta.data.data;
        }

        // Intento 2: Rescate si la directa falló (404 o sin data)
        if (!rawData) {
            const responseBusqueda = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
                params: { q: term }
            });

            const resultados = responseBusqueda.data?.data || [];
            
            // Buscamos coincidencia exacta por ID o por Código Interno
            const match = resultados.find(p => 
                p.id_propiedad == term || 
                p.codigo_interno == term
            );

            if (match) {
                // Re-intentamos la ficha usando el ID que la API reconoció en la búsqueda
                const retryResponse = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
                    params: { id_propiedad: match.id_propiedad }
                });
                rawData = retryResponse.data?.data;
            }
        }

        if (!rawData) return res.status(404).json({ error: "Propiedad no encontrada" });

        let mapeada = mapearPropiedad(rawData);

        // Geocodificación fallback
        if (!mapeada.coords.lat || !mapeada.coords.lng) {
            const direccion = `${rawData.direccion || ''}, ${rawData.com_nombre || ''}, Chile`;
            const coords = await obtenerCoordenadas(direccion);
            if (coords) mapeada.coords = coords;
        }

        res.json(mapeada);

    } catch (error) {
        console.error(`💥 [ERROR]: ${error.message}`);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;