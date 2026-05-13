const express = require('express');
const router = express.Router();
const axios = require('axios');

// Configuración de Axios
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

// ⏱️ FUNCION PARA EVITAR BLOQUEOS DEL SERVIDOR
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        console.error(`❌ [GEOCODE ERROR]: ${direccion}`);
    }
    return null;
};

const mapearPropiedad = (prop) => {
    let fotosRaw = prop.foto_principal || prop.fotos || prop.foto || prop.foto_portada || prop.imagen || prop.path_foto || prop.img_1 || [];
    
    if (typeof fotosRaw === 'string' && fotosRaw.length > 0) {
        fotosRaw = fotosRaw.includes(',') ? fotosRaw.split(',') : [fotosRaw];
    }

    const imagenesProcesadas = Array.isArray(fotosRaw) 
        ? fotosRaw.map(f => {
            if (!f || typeof f !== 'string') return null;
            let link = f.trim();
            if (link.startsWith('http')) return link;
            
            // 🚨 SOLUCIÓN AL BUG DE LAS FOTOS 🚨
            // Si el link es solo un nombre de archivo ("28909_foto.jpg") sin carpetas,
            // forzamos la ruta oficial de sistema.alaluf.com
            let cleanLink = link.startsWith('/') ? link.substring(1) : link;
            if (!cleanLink.includes('/')) {
                return `${SISTEMA_URL_ALALUF}/nuevo/uploads/${cleanLink}`;
            }

            if (!link.startsWith('/')) link = '/' + link;

            if (link.startsWith('/nuevo') || link.startsWith('/uploads')) {
                let finalPath = link.startsWith('/uploads') ? '/nuevo' + link : link;
                return `${SISTEMA_URL_ALALUF}${finalPath}`;
            }
            return `${BASE_URL_ALALUF}${link}`;
        }).filter(f => f !== null)
        : [];

    const lat = parseFloat(prop.latitud);
    const lng = parseFloat(prop.longitud);

    // Función para extraer datos ocultos (Baños, Privados, Superficie)
    const extraerCampo = (labelDeseado) => {
        if (!prop.campos_especificos || !Array.isArray(prop.campos_especificos)) return null;
        const campo = prop.campos_especificos.find(c => c.label.toLowerCase().includes(labelDeseado.toLowerCase()));
        return campo && campo.value !== null ? campo.value : null;
    };

    return {
        id: prop.id_propiedad,          
        codigo: prop.codigo_propiedad || prop.codigo_interno || prop.id_propiedad,    
        titulo: prop.desc_tipo_prop || prop.desc_tipo || "Propiedad",
        operacion: prop.desc_obj || "Venta / Arriendo",
        ubicacion: {
            comuna: prop.com_nombre || prop.comuna || "Sin Comuna",
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
            superficie: parseFloat(prop.m2_utiles || prop.m2_construidos || prop.m2_terreno || extraerCampo("m² Construidos") || extraerCampo("m² Útiles")) || 0,
            banos: parseInt(prop.banos || extraerCampo("Baños")) || 0,
            dormitorios: parseInt(prop.dormitorios || extraerCampo("Dormitorios") || extraerCampo("Habitaciones")) || 0,
            privados: parseInt(prop.privados || extraerCampo("Privados")) || 0,
            estacionamientos: parseInt(prop.estacionamientos || extraerCampo("Estacionamientos")) || 0,
            descripcion: prop.caracteristicas_internet || prop.observaciones || ""
        },
        imagenes: imagenesProcesadas
    };
};

// --- RUTAS ---

router.get('/buscar', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const alalufQuery = { ...req.query };
        delete alalufQuery.page;
        delete alalufQuery.limit;

        const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, { params: alalufQuery });
        const rawDataArray = response.data?.data || [];

        const totalItems = rawDataArray.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const propiedadesDeEstaPagina = rawDataArray.slice(startIndex, endIndex);
        const propiedadesProcesadas = [];

        for (const prop of propiedadesDeEstaPagina) {
            let mapeada = mapearPropiedad(prop);

            if (mapeada.imagenes.length === 0) {
                try {
                    // Restauramos la búsqueda por el ID real de la base de datos
                    const fichaResp = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
                        params: { id_propiedad: prop.id_propiedad } 
                    });
                    
                    if (fichaResp.data && fichaResp.data.data) {
                        const fichaCompleta = mapearPropiedad(fichaResp.data.data);
                        mapeada.imagenes = fichaCompleta.imagenes; 
                    }
                } catch (error) {
                    console.error(`❌ [FOTO ERROR]: Falló rescate para ID ${prop.id_propiedad}`);
                }
                await delay(200); 
            }

            // Para las cards mostramos solo la foto principal
            if (mapeada.imagenes.length > 0) {
                mapeada.imagenes = [mapeada.imagenes[0]];
            }

            if (!mapeada.coords.lat || !mapeada.coords.lng) {
                const calle = (prop.direccion || "").trim();
                const comuna = (prop.com_nombre || "").trim();
                if (calle.length > 3) {
                    const coords = await obtenerCoordenadas(`${calle}, ${comuna}, Chile`);
                    if (coords) mapeada.coords = coords;
                }
            }
            
            propiedadesProcesadas.push(mapeada);
        }
        
        res.json({
            data: propiedadesProcesadas,
            paginacion: {
                totalPropiedades: totalItems,
                paginaActual: page,
                totalPaginas: totalPages,
                propiedadesPorPagina: limit
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en el servidor de búsqueda" });
    }
});

router.get('/:id', async (req, res) => {
    const term = req.params.id;
    let rawData = null;

    try {
        const responseDirecta = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
            params: { id_propiedad: term }
        });
        
        if (responseDirecta.status === 200 && responseDirecta.data?.data) {
            rawData = responseDirecta.data.data;
        }

        if (!rawData) {
            const responseBusqueda = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, { params: { q: term } });
            const resultados = responseBusqueda.data?.data || [];
            const match = resultados.find(p => p.id_propiedad == term || p.codigo_interno == term);

            if (match) {
                const retryResponse = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
                    params: { id_propiedad: match.id_propiedad }
                });
                rawData = retryResponse.data?.data;
            }
        }

        if (!rawData) return res.status(404).json({ error: "Propiedad no encontrada" });

        let mapeada = mapearPropiedad(rawData);

        if (!mapeada.coords.lat || !mapeada.coords.lng) {
            const direccion = `${rawData.direccion || ''}, ${rawData.com_nombre || ''}, Chile`;
            const coords = await obtenerCoordenadas(direccion);
            if (coords) mapeada.coords = coords;
        }

        res.json(mapeada);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;