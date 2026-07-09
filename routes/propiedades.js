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
// RUTA BUSCAR OPTIMIZADA (Lotes Concurrentes)
// ─────────────────────────────────────────────────────────────
router.get('/buscar', async (req, res) => {

    const startTime = Date.now();

    
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = parseInt(req.query.limit) || 10;

        const alalufQuery = { ...req.query };
        delete alalufQuery.page;
        delete alalufQuery.limit;

        const apiQuery = { ...alalufQuery };
        delete apiQuery.comuna;
        delete apiQuery.sup_desde;
        delete apiQuery.sup_hasta;
        delete apiQuery.precio_desde;
        delete apiQuery.precio_hasta;
        delete apiQuery.moneda;
        delete apiQuery.orden;

        const cacheKey = JSON.stringify(apiQuery);
        let rawDataArray = searchCache.get(cacheKey);

        if (!rawDataArray) {
            console.log("── NO EN CACHÉ. DESCARGANDO DESDE ALALUF:", apiQuery);
            
            const firstResponse = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
                params: { ...apiQuery, limit: 50, offset: 0 }
            });

            const firstData = firstResponse.data?.data || [];
            rawDataArray = Array.isArray(firstData) ? [...firstData] : [];

           if (rawDataArray.length === 50)  {
                let currentOffset = 50;
                let hayMas = true;
                const idsVistos = new Set(rawDataArray.map(p => p.id_propiedad || p.codigo_interno));
                
                // 🚀 Reducimos a 2 peticiones simultáneas para evitar que Alaluf nos bloquee la IP
                const BATCH_SIZE = 2; 

                while (hayMas && currentOffset <= 5000) {
                    const promesasBatch = [];
                    for (let i = 0; i < BATCH_SIZE; i++) {
                        promesasBatch.push(
                            alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
                                params: { ...apiQuery, limit: 50, offset: currentOffset + (i * 50) }
                            }).catch(() => null) 
                        );
                    }

                    const respuestas = await Promise.all(promesasBatch);
                    let batchTuvoResultadosVacios = false;

                    for (const resp of respuestas) {
                        const data = resp?.data?.data;
                        if (!data || !Array.isArray(data) || data.length === 0) {
                            batchTuvoResultadosVacios = true;
                            continue;
                        }
                        
                        data.forEach(p => {
                            const id = p.id_propiedad || p.codigo_interno;
                            if (!idsVistos.has(id)) {
                                idsVistos.add(id);
                                rawDataArray.push(p);
                            }
                        });

                        if (data.length < 50) {
                            batchTuvoResultadosVacios = true;
                        }
                    }

                    if (batchTuvoResultadosVacios) hayMas = false;
                    currentOffset += (50 * BATCH_SIZE);
                }
            }
            
            searchCache.set(cacheKey, rawDataArray);
            console.log(`TOTAL DESCARGADO Y GUARDADO EN CACHÉ: ${rawDataArray.length}`);
            console.log(`DEBUG [1 - Descarga]: ${Date.now() - startTime}ms`);
        } else {
            console.log(`── SIRVIENDO DESDE CACHÉ: ${rawDataArray.length} propiedades encontradas`);
        }

        let mappedItems = rawDataArray.map(prop => mapearPropiedad(prop));

        // 🌟 FILTROS ESTRICTOS (Migrados tal cual los tenías en tu Frontend)
        const fComuna = req.query.comuna && req.query.comuna !== "undefined" ? req.query.comuna : "";
        const fSupDesde = parseFloat(req.query.sup_desde);
        const fSupHasta = parseFloat(req.query.sup_hasta);
        const fPrecioDesde = parseFloat(req.query.precio_desde);
        const fPrecioHasta = parseFloat(req.query.precio_hasta);
        const fOrden = req.query.orden || 'desc'; 
        const fObj = req.query.obj || "1";

        mappedItems = mappedItems.filter(item => {
            let match = true;

            // 1. Filtro estricto de Operación (Comprar = 1, Arrendar = 2)
            const valVenta = parseFloat(item.precios?.venta?.valor || 0);
            const valArriendo = parseFloat(item.precios?.arriendo?.valor || 0);
            const tieneVenta = valVenta > 0;
            const tieneArriendo = valArriendo > 0;

            if (fObj === "1") match = match && tieneVenta;
            if (fObj === "2") match = match && tieneArriendo;

            // 2. Comuna
            if (fComuna) {
                match = match && item.ubicacion.comuna.toLowerCase().includes(fComuna.toLowerCase());
            }

            // 3. Superficie
            if (!isNaN(fSupDesde)) match = match && item.detalles.superficie >= fSupDesde;
            if (!isNaN(fSupHasta)) match = match && item.detalles.superficie <= fSupHasta;

            // 4. Precios
            if (!isNaN(fPrecioDesde) || !isNaN(fPrecioHasta)) {
                const valorMax = Math.max(valVenta, valArriendo);
                if (!isNaN(fPrecioDesde)) match = match && valorMax >= fPrecioDesde;
                if (!isNaN(fPrecioHasta)) match = match && valorMax <= fPrecioHasta;
            }

            return match;
        });

        // 🌟 ORDENAMIENTO SEGURO
        mappedItems.sort((a, b) => {
            if (fOrden === 'asc' || fOrden === 'desc') {
                const valA = Math.max(parseFloat(a.precios?.venta?.valor || 0), parseFloat(a.precios?.arriendo?.valor || 0));
                const valB = Math.max(parseFloat(b.precios?.venta?.valor || 0), parseFloat(b.precios?.arriendo?.valor || 0));
                return fOrden === 'asc' ? valA - valB : valB - valA;
            }
            // Por defecto: Más recientes primero usando IDs de forma segura
            const idA = parseInt(a.id) || 0;
            const idB = parseInt(b.id) || 0;
            return idB - idA;
        });

        console.log(`DEBUG [2 - Filtros y Sort]: ${Date.now() - startTime}ms`);

        // 🚀 Paginación
        const totalItems = mappedItems.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const propiedadesDeEstaPagina = mappedItems.slice(startIndex, startIndex + limit);

        // Enriquecer solo las propiedades de la página actual
        const promesasDetalles = propiedadesDeEstaPagina.map(async (mapeada) => {
            if (mapeada.imagenes.length === 0 || !mapeada.coords.lat) {
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
                            detailCache.set(fichaCacheKey, fichaCompleta); 
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

        console.log(`DEBUG [3 - Enriquecimiento detalles]: ${Date.now() - startTime}ms`);

        const resultados = await Promise.all(promesasDetalles);

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
// RUTA INDIVIDUAL 
// ─────────────────────────────────────────────────────────────
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