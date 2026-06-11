const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache');

// 🚀 Caché en memoria: guarda búsquedas por 10 minutos (600 segundos)
// y los detalles individuales por 30 minutos (1800 segundos)
const searchCache = new NodeCache({ stdTTL: 600 });
const detailCache = new NodeCache({ stdTTL: 1800 });

const alalufAxios = axios.create({
    headers: {
        'X-API-KEY': process.env.ALALUF_API_KEY,
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    },
    timeout: 15000,
    validateStatus: (status) => status < 500 
});

const BASE_URL_ALALUF = "https://alaluf.cl";
const SISTEMA_URL_ALALUF = "https://sistema.alaluf.com"; 

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
            let cleanLink = link.startsWith('/') ? link.substring(1) : link;
            if (!cleanLink.includes('/')) return `${SISTEMA_URL_ALALUF}/nuevo/uploads/${cleanLink}`;
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
            caracteristicasExtra: prop.campos_especificos || [],
            descripcion: prop.caracteristicas_internet || prop.observaciones || ""
        },
        imagenes: imagenesProcesadas
    };
};

// ─────────────────────────────────────────────────────────────
// RUTA BUSCAR OPTIMIZADA
// ─────────────────────────────────────────────────────────────
router.get('/buscar', async (req, res) => {
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = parseInt(req.query.limit) || 10;

        const alalufQuery = { ...req.query };
        delete alalufQuery.page;
        delete alalufQuery.limit;

        // 🚀 Generamos un identificador único para los parámetros de búsqueda exactos
        const cacheKey = JSON.stringify(alalufQuery);
        let rawDataArray = searchCache.get(cacheKey);

        // Solo vamos a la API externa si la búsqueda no está en caché
        if (!rawDataArray) {
            console.log("── NO EN CACHÉ. DESCARGANDO DESDE ALALUF:", alalufQuery);
            
            const firstResponse = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
                params: { ...alalufQuery, limit: 50, offset: 0 }
            });

            const firstData = firstResponse.data?.data || [];
            rawDataArray = [...firstData];

            if (firstData.length === 50) {
                let offset = 50;
                let hayMas = true;
                const idsVistos = new Set(firstData.map(p => p.id_propiedad || p.codigo_interno));

                while (hayMas && offset <= 5000) {
                    const resp = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
                        params: { ...alalufQuery, limit: 50, offset }
                    }).catch(() => null);

                    const data = resp?.data?.data || [];
                    
                    if (data.length === 0) break;

                    const nuevos = data.filter(p => !idsVistos.has(p.id_propiedad || p.codigo_interno));
                    if (nuevos.length === 0) break;

                    nuevos.forEach(p => {
                        idsVistos.add(p.id_propiedad || p.codigo_interno);
                        rawDataArray.push(p);
                    });

                    if (data.length < 50) hayMas = false;
                    offset += 50;
                }
            }
            
            // 🚀 Guardamos el arreglo masivo en memoria para las próximas peticiones
            searchCache.set(cacheKey, rawDataArray);
            console.log(`TOTAL DESCARGADO Y GUARDADO EN CACHÉ: ${rawDataArray.length}`);
        } else {
            console.log(`── SIRVIENDO DESDE CACHÉ: ${rawDataArray.length} propiedades encontradas`);
        }

        // Paginación sobre el arreglo (sea de caché o recién descargado)
        const totalItems = rawDataArray.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const propiedadesDeEstaPagina = rawDataArray.slice(startIndex, startIndex + limit);

        // Enriquecer con fotos / coords optimizado con caché individual
        const promesas = propiedadesDeEstaPagina.map(async (prop) => {
            let mapeada = mapearPropiedad(prop);

            if (mapeada.imagenes.length === 0 || !mapeada.coords.lat) {
                // 🚀 Revisar si ya tenemos la ficha guardada
                const fichaCacheKey = `ficha_${mapeada.codigo}`;
                let fichaCompleta = detailCache.get(fichaCacheKey);

                if (!fichaCompleta) {
                    try {
                        const fichaResp = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
                            params: { id_propiedad: mapeada.codigo },
                            timeout: 4000
                        });
                        if (fichaResp.data?.data) {
                            fichaCompleta = mapearPropiedad(fichaResp.data.data);
                            detailCache.set(fichaCacheKey, fichaCompleta); // Guardar en caché
                        }
                    } catch (e) {
                        console.error(`Error obteniendo ID ${mapeada.codigo}`);
                    }
                }

                if (fichaCompleta) {
                    if (mapeada.imagenes.length === 0) mapeada.imagenes = fichaCompleta.imagenes;
                    if (!mapeada.coords.lat) mapeada.coords = fichaCompleta.coords;
                    mapeada.detalles = fichaCompleta.detalles;
                }
            }
            return mapeada;
        });

        const resultados = await Promise.all(promesas);

        res.json({
            data: resultados,
            paginacion: {
                totalPropiedades: totalItems,
                paginaActual: page,
                totalPaginas: totalPages,
                propiedadesPorPagina: limit
            }
        });

    } catch (error) {
        console.error("Error en /buscar:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ─────────────────────────────────────────────────────────────
// RUTA INDIVIDUAL (También cacheada)
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    const term = req.params.id;
    const cacheKey = `ficha_endpoint_${term}`;
    
    // 🚀 Intentar recuperar de caché
    const cachedResponse = detailCache.get(cacheKey);
    if (cachedResponse) return res.json(cachedResponse);

    try {
        const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, { params: { id_propiedad: term } });
        if (response.data?.data) {
            const dataMapeada = mapearPropiedad(response.data.data);
            detailCache.set(cacheKey, dataMapeada);
            return res.json(dataMapeada);
        }
        
        const search = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, { params: { q: term } });
        const match = (search.data?.data || []).find(p => p.id_propiedad == term || p.codigo_interno == term);
        if (match) {
            const retry = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, { params: { id_propiedad: match.id_propiedad } });
            const dataRetry = mapearPropiedad(retry.data.data);
            detailCache.set(cacheKey, dataRetry);
            return res.json(dataRetry);
        }
        res.status(404).json({ error: "No encontrada" });
    } catch (e) {
        res.status(500).send("Error");
    }
});

module.exports = router;