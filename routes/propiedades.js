const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache');

// Caché para detalles individuales (1 hora)
const detailCache = new NodeCache({ stdTTL: 3600 });

const alalufAxios = axios.create({
    headers: {
        'X-API-KEY': process.env.ALALUF_API_KEY,
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64)',
        'Accept': 'application/json'
    },
    timeout: 10000, 
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
// BASE DE DATOS EN MEMORIA (SYNC NO BLOQUEANTE)
// ─────────────────────────────────────────────────────────────
let MEMORY_DB = [];
let isSyncing = false;

const syncDatabase = async () => {
    if (isSyncing) return;
    isSyncing = true;
    console.log("🔄 [CRON] Iniciando sincronización de propiedades...");
    
    try {
        let offset = 0;
        let tempArray = []; 
        let idsVistos = new Set();
        let keepFetching = true;

        while (keepFetching && offset <= 6000) {
            const resp = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
                params: { limit: 50, offset }
            }).catch(() => null);

            const data = resp?.data?.data || [];
            if (data.length === 0) break;

            data.forEach(p => {
                const id = p.id_propiedad || p.codigo_interno;
                if (!idsVistos.has(id)) {
                    idsVistos.add(id);
                    tempArray.push(p); 
                }
            });

            if (data.length < 50) keepFetching = false;
            offset += 50;
            
            await new Promise(resolve => setTimeout(resolve, 100)); 
        }

        if (tempArray.length > 500) {
            MEMORY_DB = tempArray;
            console.log(`✅ [CRON] Sincronización exitosa. ${MEMORY_DB.length} propiedades listas.`);
        }
    } catch (error) {
        console.error("❌ [CRON] Error no bloqueante:", error.message);
    } finally {
        isSyncing = false;
    }
};

// Ejecutar al iniciar y cada 1 hora
syncDatabase();
setInterval(syncDatabase, 60 * 60 * 1000);

// ─────────────────────────────────────────────────────────────
// RUTA BUSCAR ULTRARRÁPIDA (Filtra en RAM)
// ─────────────────────────────────────────────────────────────
router.get('/buscar', async (req, res) => {
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        let rawDataArray = MEMORY_DB;

        // Fallback de emergencia
        if (rawDataArray.length === 0) {
            const fallbackResp = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, { 
                params: { limit: 100 } 
            }).catch(() => null);
            rawDataArray = fallbackResp?.data?.data || [];
        }

        // Filtros básicos
        if (req.query.tipo_prop) {
            rawDataArray = rawDataArray.filter(p => p.tipo_prop == req.query.tipo_prop || p.id_tipo_prop == req.query.tipo_prop);
        }
        if (req.query.obj) {
            rawDataArray = rawDataArray.filter(p => p.obj == req.query.obj);
        }

        let mappedItems = rawDataArray.map(prop => mapearPropiedad(prop));

        // Filtros avanzados
        const fComuna = req.query.comuna;
        const fSupDesde = parseFloat(req.query.sup_desde);
        const fSupHasta = parseFloat(req.query.sup_hasta);
        const fPrecioDesde = parseFloat(req.query.precio_desde);
        const fPrecioHasta = parseFloat(req.query.precio_hasta);
        const fOrden = req.query.orden || 'desc'; 

        mappedItems = mappedItems.filter(item => {
            let match = true;
            if (fComuna) match = match && item.ubicacion.comuna.toLowerCase().includes(fComuna.toLowerCase());
            if (!isNaN(fSupDesde)) match = match && item.detalles.superficie >= fSupDesde;
            if (!isNaN(fSupHasta)) match = match && item.detalles.superficie <= fSupHasta;
            
            if (!isNaN(fPrecioDesde) || !isNaN(fPrecioHasta)) {
                const valVenta = parseFloat(item.precios.venta.valor || 0);
                const valArriendo = parseFloat(item.precios.arriendo.valor || 0);
                const valorMax = Math.max(valVenta, valArriendo);
                
                if (!isNaN(fPrecioDesde)) match = match && valorMax >= fPrecioDesde;
                if (!isNaN(fPrecioHasta)) match = match && valorMax <= fPrecioHasta;
            }
            return match;
        });

        mappedItems.sort((a, b) => {
            const getPrice = (item) => Math.max(parseFloat(item.precios.venta.valor || 0), parseFloat(item.precios.arriendo.valor || 0));
            const priceDiff = fOrden === 'asc' ? getPrice(a) - getPrice(b) : getPrice(b) - getPrice(a);
            return priceDiff !== 0 ? priceDiff : b.id - a.id; 
        });

        const totalItems = mappedItems.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const propiedadesDeEstaPagina = mappedItems.slice(startIndex, startIndex + limit);

        const promesas = propiedadesDeEstaPagina.map(async (mapeada) => {
            if (mapeada.imagenes.length === 0 || !mapeada.coords.lat) {
                const fichaCacheKey = `ficha_${mapeada.codigo}`;
                let fichaCompleta = detailCache.get(fichaCacheKey);

                if (!fichaCompleta) {
                    try {
                        const fichaResp = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
                            params: { id_propiedad: mapeada.codigo },
                            timeout: 800 
                        });
                        if (fichaResp.data?.data) {
                            fichaCompleta = mapearPropiedad(fichaResp.data.data);
                            detailCache.set(fichaCacheKey, fichaCompleta); 
                        }
                    } catch (e) {}
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
        console.error("Error en /buscar:", error.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

router.get('/:id', async (req, res) => {
    const term = req.params.id;
    const cacheKey = `ficha_endpoint_${term}`;
    
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