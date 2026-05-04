const express = require('express');
const router = express.Router();
const axios = require('axios');

// Configuración de Axios para Alaluf
const alalufAxios = axios.create({
    headers: {
        'X-API-KEY': process.env.ALALUF_API_KEY,
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    },
    timeout: 30000 
});

const BASE_URL_ALALUF = "https://alaluf.cl";
const SISTEMA_URL_ALALUF = "https://sistema.alaluf.com"; 

/**
 * MEJORA: Función de Geocodificación con Reintentos y Fallback
 */
const obtenerCoordenadas = async (direccion) => {
    const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN;
    
    if (!token) {
        console.error("❌ [ERROR] MAPBOX_TOKEN no detectado. Revisa tu archivo .env");
        return null;
    }

    try {
        const query = encodeURIComponent(direccion);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1&country=cl`;
        
        const resp = await axios.get(url, { timeout: 5000 }); // Timeout corto para no bloquear

        if (resp.data.features && resp.data.features.length > 0) {
            const [lng, lat] = resp.data.features[0].center;
            return { lat, lng };
        }
    } catch (error) {
        console.error(`❌ [ERROR GEOCODE]: ${direccion} - ${error.message}`);
    }
    return null;
};

const mapearPropiedad = (prop) => {
    let fotosRaw = prop.fotos || prop.foto || prop.foto_portada || prop.imagen || [];
    
    if (typeof fotosRaw === 'string' && fotosRaw.length > 0) {
        fotosRaw = [fotosRaw];
    }

    const imagenesProcesadas = Array.isArray(fotosRaw) 
        ? fotosRaw.map(f => {
            if (!f || typeof f !== 'string') return null;
            const link = f.trim();
            if (link.startsWith('http')) return link;
            if (link.startsWith('/nuevo')) return `${SISTEMA_URL_ALALUF}${link}`;
            return `${BASE_URL_ALALUF}${link.startsWith('/') ? link : '/' + link}`;
        }).filter(f => f !== null)
        : [];

    // Validamos: si la API manda 0 o null, lo marcamos como null para el proceso de mejora
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

        // MEJORA: Procesamiento inteligente de coordenadas
        const propiedadesProcesadas = await Promise.all(rawDataArray.map(async (prop) => {
            let mapeada = mapearPropiedad(prop);

            // Si no hay coordenadas, entramos al flujo de recuperación
            if (!mapeada.coords.lat || !mapeada.coords.lng) {
                const calle = (prop.direccion || "").trim();
                const comuna = (prop.com_nombre || "").trim();

                // Intento 1: Dirección completa
                if (calle.length > 3) {
                    const busquedaFull = `${calle}, ${comuna}, Chile`;
                    const coords = await obtenerCoordenadas(busquedaFull);
                    if (coords) {
                        mapeada.coords = coords;
                        console.log(`✅ [OK] Geolocalizado: ${busquedaFull}`);
                    }
                }

                // Intento 2: Solo Comuna (Fallback para que el mapa no quede vacío)
                if (!mapeada.coords.lat && comuna.length > 2) {
                    const busquedaComuna = `${comuna}, Chile`;
                    const coordsComuna = await obtenerCoordenadas(busquedaComuna);
                    if (coordsComuna) {
                        mapeada.coords = coordsComuna;
                        console.log(`⚠️ [FALLBACK] Geolocalizado por Comuna: ${busquedaComuna}`);
                    }
                }
            }
            return mapeada;
        }));

        res.json(propiedadesProcesadas);
    } catch (error) {
        console.error(`[ALALUF ERROR] ${error.message}`);
        res.status(500).json({ error: "Error en el servidor de búsqueda" });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
            params: { id_propiedad: req.params.id }
        });
        const rawData = response.data?.data;
        if (!rawData) return res.status(404).json({ error: "Propiedad no encontrada" });

        let mapeada = mapearPropiedad(rawData);

        // Lógica de recuperación para ficha individual
        if (!mapeada.coords.lat || !mapeada.coords.lng) {
            const direccion = `${rawData.direccion || ''}, ${rawData.com_nombre || ''}, Chile`;
            const coords = await obtenerCoordenadas(direccion);
            if (coords) {
                mapeada.coords = coords;
            } else {
                // Fallback a comuna si falla la dirección
                const coordsComuna = await obtenerCoordenadas(`${rawData.com_nombre}, Chile`);
                if (coordsComuna) mapeada.coords = coordsComuna;
            }
        }

        res.json(mapeada);
    } catch (error) {
        res.status(500).json({ error: "Error al cargar la propiedad" });
    }
});

module.exports = router;