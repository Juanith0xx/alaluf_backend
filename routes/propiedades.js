const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('node:https');
const NodeCache = require('node-cache');
const { performance } = require('node:perf_hooks');

// Caché fresca: resultados válidos durante 10 minutos.
const searchCache = new NodeCache({
    stdTTL: 600,
    checkperiod: 120,
    useClones: false
});

// Caché de respaldo: permite responder de inmediato mientras se actualiza
// el catálogo en segundo plano. Evita volver a castigar al usuario después
// de vencer la caché fresca o ante una caída temporal de Alaluf.
const staleSearchCache = new NodeCache({
    stdTTL: 3600,
    checkperiod: 300,
    useClones: false
});

const detailCache = new NodeCache({
    stdTTL: 1800,
    checkperiod: 120,
    useClones: false
});

// Evita que solicitudes iguales descarguen el mismo catálogo simultáneamente.
const pendingSearches = new Map();
const pendingDetails = new Map();

const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    maxFreeSockets: 10,
    timeout: 10000
});

const alalufAxios = axios.create({
    httpsAgent: keepAliveAgent,
    headers: {
        'X-API-KEY': process.env.ALALUF_API_KEY,
        'User-Agent':
            'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
    },
    timeout: 5000,
    validateStatus: (status) => status >= 200 && status < 500
});

const BASE_URL_ALALUF = 'https://alaluf.cl';
const SISTEMA_URL_ALALUF = 'https://sistema.alaluf.com';

const COMUNAS_POR_CODIGO = Object.freeze({
    '1101': 'Iquique',
    '1211': 'Alto Hospicio',
    '1401': 'Pozo Almonte',
    '2101': 'Antofagasta',
    '2301': 'Calama',
    '3101': 'Copiapó',
    '3302': 'Freirina',
    '4101': 'La Serena',
    '4102': 'Coquimbo',
    '4106': 'Paihuano',
    '4203': 'Los Vilos',
    '4204': 'Punitaqui',
    '4301': 'Ovalle',
    '5101': 'Valparaiso',
    '5102': 'Casablanca',
    '5103': 'Concón',
    '5106': 'Quilpué',
    '5107': 'Quintero',
    '5109': 'Viña del Mar',
    '5301': 'Los Andes',
    '5303': 'Rinconada',
    '5501': 'Quillota',
    '5503': 'Hijuelas',
    '5505': 'Limache',
    '5507': 'Olmue',
    '5601': 'San Antonio',
    '5602': 'Algarrobo',
    '5603': 'Cartagena',
    '5604': 'El Quisco',
    '5606': 'Santo Domingo',
    '5607': 'El Tabo',
    '5701': 'San Felipe',
    '5702': 'Catemu',
    '5705': 'Putaendo',
    '6101': 'Rancagua',
    '6102': 'Codegua',
    '6107': 'Las Cabras',
    '6108': 'Machalí',
    '6202': 'La Estrella',
    '6203': 'Litueche',
    '6301': 'San Fernando',
    '6303': 'Chimbarongo',
    '6310': 'Santa Cruz',
    '7101': 'Talca',
    '7102': 'Constitución',
    '7103': 'Romeral',
    '7201': 'Cauquenes',
    '7206': 'Maule',
    '7301': 'Curicó',
    '7401': 'Linares',
    '7403': 'Longaví',
    '7404': 'Parral',
    '8101': 'Concepción',
    '8109': 'San Carlos',
    '8212': 'Hualpén',
    '8301': 'Los Angeles',
    '8401': 'Chillán',
    '9101': 'Temuco',
    '9115': 'Pucón',
    '9120': 'Villarrica',
    '10101': 'Puerto Montt',
    '10105': 'Futrono',
    '10108': 'Panguipulli',
    '10109': 'Puerto Varas',
    '10111': 'Río Bueno',
    '10201': 'Castro',
    '10203': 'Puerto Octay',
    '10301': 'Osorno',
    '10306': 'Llanquihue',
    '10402': 'Chonchi',
    '10406': 'Ancud',
    '10501': 'Valdivia',
    '11101': 'Chile Chico',
    '11201': 'Aysén',
    '12101': 'Natales',
    '12205': 'Punta Arenas',
    '13101': 'Santiago',
    '13102': 'Cerrillos',
    '13103': 'Cerro Navia',
    '13104': 'Conchalí',
    '13105': 'El Bosque',
    '13106': 'Estación Central',
    '13107': 'Huechuraba',
    '13108': 'Independencia',
    '13109': 'La Cisterna',
    '13110': 'La Florida',
    '13111': 'La Granja',
    '13112': 'La Pintana',
    '13113': 'La Reina',
    '13114': 'Las Condes',
    '13115': 'Lo Barnechea',
    '13116': 'Lo Espejo',
    '13117': 'Lo Prado',
    '13118': 'Macul',
    '13119': 'Maipú',
    '13120': 'Ñuñoa',
    '13121': 'Pedro Aguirre Cerda',
    '13122': 'Peñalolén',
    '13123': 'Providencia',
    '13124': 'Pudahuel',
    '13125': 'Quilicura',
    '13126': 'Quinta Normal',
    '13127': 'Recoleta',
    '13128': 'Renca',
    '13129': 'San Joaquín',
    '13130': 'San Miguel',
    '13131': 'San Ramón',
    '13132': 'Vitacura',
    '13134': 'Laguna de Aculeo',
    '13201': 'Puente Alto',
    '13202': 'Pirque',
    '13203': 'San José de Maipo',
    '13301': 'Colina',
    '13302': 'Lampa',
    '13303': 'Tiltil',
    '13401': 'San Bernardo',
    '13402': 'Buin',
    '13403': 'Calera de Tango',
    '13404': 'Paine',
    '13501': 'Melipilla',
    '13502': 'Alhué',
    '13503': 'Curacaví',
    '13504': 'María Pinto',
    '13505': 'San Pedro',
    '13601': 'Talagante',
    '13602': 'El Monte',
    '13603': 'Isla de Maipo',
    '13604': 'Padre Hurtado',
    '13605': 'Peñaflor',
    '13608': 'Llay-Llay',
    '13609': 'La Ligua',
    '13612': 'Requinoa',
    '13617': 'Frutillar',
    '13619': 'Isla de Pascua',
    '13620': 'Puchuncavi',
    '13621': 'Placilla',
    '13622': 'Vallenar',
    '13623': 'Illapel',
    '13624': 'Salamanca',
    '13625': 'La Ligua',
    '13626': 'Pichilemu',
    '13627': 'Zapallar',
    '13628': 'Tome',
    '13629': 'Villa Alemana',
    '13630': 'Arauco',
    '13631': 'Papudo',
    '13632': 'Cochamo',
    '13633': 'Los Muermos',
    '13634': 'San Juan de la Costa',
    '13635': 'Santa Maria',
    '13636': 'Coronel',
    '13637': 'San Pedro de la Paz',
    '13638': 'Navidad',
    '13639': 'Arica',
    '13670': 'Vicuña',
    '13671': 'Talcahuano',
    '13672': 'La Cruz',
    '14201': 'La Unión',
    '16101': 'Nuble',
    '16103': 'San Francisco de Mostazal',
});

// La API soporta limit/offset. Usamos páginas internas más grandes para reducir
// la cantidad de viajes a PHP, pero al frontend solo se le entregan 10/20 ítems.
// La API de Alaluf actualmente limita la respuesta real a cerca de 20
// elementos aunque se solicite un límite mayor. Se solicita 1000 primero
// por si el proveedor habilita nuevamente respuestas grandes.
const CATALOG_PAGE_SIZE = 1000;

// Con 531 propiedades y páginas reales de 20 registros se requieren unas
// 27 llamadas. Ejecutar 7 en paralelo reduce el proceso a aproximadamente
// cinco rondas, en vez de las catorce rondas que producía BATCH_SIZE = 2.
const BATCH_SIZE = 7;
const MAX_OFFSET = 10000;

const limpiarValor = (value) => {
    if (value === undefined || value === null) return '';
    const normalized = String(value).trim();
    return normalized === 'undefined' || normalized === 'null' ? '' : normalized;
};

const normalizarTexto = (value) => {
    return limpiarValor(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
};

const parsePositiveInt = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};

const crearCacheKey = (prefix, params) => {
    const normalized = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([key, value]) => `${key}=${String(value).trim().toLowerCase()}`)
        .join('&');

    return `${prefix}|${normalized}`;
};

const extraerItems = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.resultados)) return payload.resultados;
    if (Array.isArray(payload?.propiedades)) return payload.propiedades;
    return [];
};

const obtenerIdUnico = (prop = {}) => {
    return String(
        prop.id_propiedad ||
        prop.codigo_propiedad ||
        prop.codigo_interno ||
        ''
    );
};

const mapearPropiedad = (prop = {}) => {
    let fotosRaw =
        prop.foto_principal ||
        prop.fotos ||
        prop.foto ||
        prop.foto_portada ||
        prop.imagen ||
        prop.path_foto ||
        prop.img_1 ||
        [];

    if (typeof fotosRaw === 'string' && fotosRaw.length > 0) {
        fotosRaw = fotosRaw.includes(',') ? fotosRaw.split(',') : [fotosRaw];
    }

    const imagenesProcesadas = Array.isArray(fotosRaw)
        ? fotosRaw
            .map((foto) => {
                if (!foto || typeof foto !== 'string') return null;

                let link = foto.trim();
                if (!link) return null;
                if (link.startsWith('http')) return link;

                const cleanLink = link.startsWith('/') ? link.substring(1) : link;

                if (!cleanLink.includes('/')) {
                    return `${SISTEMA_URL_ALALUF}/nuevo/uploads/${cleanLink}`;
                }

                if (!link.startsWith('/')) link = `/${link}`;

                if (link.startsWith('/nuevo') || link.startsWith('/uploads')) {
                    const finalPath = link.startsWith('/uploads')
                        ? `/nuevo${link}`
                        : link;
                    return `${SISTEMA_URL_ALALUF}${finalPath}`;
                }

                return `${BASE_URL_ALALUF}${link}`;
            })
            .filter(Boolean)
        : [];

    const lat = Number.parseFloat(prop.latitud);
    const lng = Number.parseFloat(prop.longitud);

    const extraerCampo = (labelDeseado) => {
        if (!Array.isArray(prop.campos_especificos)) return null;

        const campo = prop.campos_especificos.find((item) => {
            return (
                typeof item?.label === 'string' &&
                item.label.toLowerCase().includes(labelDeseado.toLowerCase())
            );
        });

        return campo?.value ?? null;
    };

    return {
        id: prop.id_propiedad,
        codigo:
            prop.codigo_propiedad ||
            prop.codigo_interno ||
            prop.id_propiedad,
        titulo: prop.desc_tipo_prop || prop.desc_tipo || 'Propiedad',
        operacion: prop.desc_obj || 'Venta / Arriendo',
        ubicacion: {
            comuna: prop.com_nombre || prop.comuna || 'Sin Comuna',
            codigoComuna: limpiarValor(
                prop.com_codigo ||
                prop.codigo_comuna ||
                prop.cod_comuna ||
                prop.com_cod ||
                prop.id_comuna ||
                prop.comuna_id ||
                prop.com_id
            ) || null,
            sector: prop.sector_cercano || 'Sin Sector',
            region: prop.region || 'Metropolitana',
            direccion: prop.direccion || ''
        },
        coords: {
            lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
            lng: Number.isFinite(lng) && lng !== 0 ? lng : null
        },
        precios: {
            venta: {
                valor:
                    prop.valor_venta && prop.valor_venta !== '0'
                        ? prop.valor_venta
                        : null,
                moneda: prop.moneda_venta || 'UF'
            },
            arriendo: {
                valor:
                    prop.valor_arriendo && prop.valor_arriendo !== '0'
                        ? prop.valor_arriendo
                        : null,
                moneda: prop.moneda_arriendo || 'UF/m2'
            }
        },
        detalles: {
            superficie:
                Number.parseFloat(
                    prop.m2_utiles ||
                    prop.m2_construidos ||
                    prop.m2_terreno ||
                    extraerCampo('m² Construidos') ||
                    extraerCampo('m² Útiles')
                ) || 0,
            banos:
                Number.parseInt(prop.banos || extraerCampo('Baños'), 10) || 0,
            dormitorios:
                Number.parseInt(
                    prop.dormitorios ||
                    extraerCampo('Dormitorios') ||
                    extraerCampo('Habitaciones'),
                    10
                ) || 0,
            privados:
                Number.parseInt(prop.privados || extraerCampo('Privados'), 10) || 0,
            estacionamientos:
                Number.parseInt(
                    prop.estacionamientos || extraerCampo('Estacionamientos'),
                    10
                ) || 0,
            caracteristicasExtra: prop.campos_especificos || [],
            descripcion:
                prop.caracteristicas_internet || prop.observaciones || ''
        },
        imagenes: imagenesProcesadas
    };
};

const obtenerConsulta = (query) => {
    const esDestacada = limpiarValor(query.destaq).toLowerCase() === 'true';
    const page = parsePositiveInt(query.page, 1);
    const limit = parsePositiveInt(query.limit, esDestacada ? 20 : 10, 50);
    const offset = (page - 1) * limit;

    const tipoProp = limpiarValor(query.tipo_prop || query.tipo);
    const obj = limpiarValor(query.obj || query.objetivo);
    const comunaCodigo = limpiarValor(query.comuna);
    const comunaNombre = limpiarValor(
        query.comuna_nombre ||
        query.comuna_label ||
        COMUNAS_POR_CODIGO[comunaCodigo]
    );
    const precioMin = limpiarValor(query.precio_min || query.precio_desde);
    const precioMax = limpiarValor(query.precio_max || query.precio_hasta);
    const moneda = limpiarValor(query.moneda);
    const destaq = limpiarValor(query.destaq);

    // Solo incluye filtros que cambian el catálogo base. Página, límite,
    // superficie y orden se procesan localmente para reutilizar la caché.
    const catalogQuery = {
        tipo_prop: tipoProp
    };

    if (obj) catalogQuery.obj = obj;
    if (precioMin) catalogQuery.precio_min = precioMin;
    if (precioMax) catalogQuery.precio_max = precioMax;

    if (moneda && (precioMin || precioMax)) {
        catalogQuery.moneda = moneda;
    }

    if (destaq) catalogQuery.destaq = destaq;

    return {
        page,
        limit,
        offset,
        catalogQuery,
        orden: limpiarValor(query.orden).toLowerCase(),
        dir: limpiarValor(query.dir).toUpperCase(),
        obj,
        comunaCodigo,
        comunaNombre,
        supDesde: Number.parseFloat(query.sup_desde),
        supHasta: Number.parseFloat(query.sup_hasta)
    };
};

const solicitarPaginaAlaluf = async (catalogQuery, limit, offset) => {
    const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
        params: {
            ...catalogQuery,
            limit,
            offset
        }
    });

    if (response.status >= 400) {
        const error = new Error(`La API Alaluf respondió HTTP ${response.status}`);
        error.response = response;
        throw error;
    }

    return extraerItems(response.data);
};

const construirCatalogo = async (catalogQuery, cacheKey) => {
    const apiStartedAt = performance.now();
    let peticionesApi = 0;
    let catalogoCompleto = true;

    const primeraPagina = await solicitarPaginaAlaluf(
        catalogQuery,
        CATALOG_PAGE_SIZE,
        0
    );
    peticionesApi += 1;

    const catalogo = [];
    const idsVistos = new Set();

    const agregarItems = (items) => {
        for (const item of items) {
            const id = obtenerIdUnico(item);

            if (!id) {
                catalogo.push(item);
                continue;
            }

            if (!idsVistos.has(id)) {
                idsVistos.add(id);
                catalogo.push(item);
            }
        }
    };

    agregarItems(primeraPagina);

    if (primeraPagina.length > 0) {
        const effectivePageSize = primeraPagina.length;
        let currentOffset = effectivePageSize;
        let hayMas = true;

        while (hayMas && currentOffset <= MAX_OFFSET) {
            const offsets = Array.from(
                { length: BATCH_SIZE },
                (_, index) => currentOffset + index * effectivePageSize
            );

            const respuestas = await Promise.allSettled(
                offsets.map((requestOffset) =>
                    solicitarPaginaAlaluf(
                        catalogQuery,
                        CATALOG_PAGE_SIZE,
                        requestOffset
                    )
                )
            );

            peticionesApi += respuestas.length;

            let encontroPaginaFinal = false;
            let huboError = false;

            respuestas.forEach((resultado, index) => {
                if (resultado.status === 'rejected') {
                    huboError = true;
                    console.error(
                        `Error descargando offset ${offsets[index]}:`,
                        resultado.reason?.message || resultado.reason
                    );
                    return;
                }

                const items = resultado.value;

                if (!Array.isArray(items) || items.length === 0) {
                    encontroPaginaFinal = true;
                    return;
                }

                agregarItems(items);

                if (items.length < effectivePageSize) {
                    encontroPaginaFinal = true;
                }
            });

            if (huboError) {
                throw new Error(
                    'No fue posible completar todas las páginas del catálogo.'
                );
            }

            if (encontroPaginaFinal) {
                hayMas = false;
            }

            currentOffset += effectivePageSize * BATCH_SIZE;
        }
    }

    const result = {
        items: catalogo,
        apiMs: performance.now() - apiStartedAt,
        peticionesApi,
        catalogoCompleto,
        updatedAt: Date.now()
    };

    // Solo se promociona a caché fresca cuando el catálogo terminó de forma
    // correcta. El respaldo conserva el último catálogo utilizable.
    if (catalogoCompleto) {
        searchCache.set(cacheKey, result);
        staleSearchCache.set(cacheKey, result);
    }

    return result;
};

const iniciarActualizacionCatalogo = (catalogQuery, cacheKey) => {
    if (pendingSearches.has(cacheKey)) {
        return pendingSearches.get(cacheKey);
    }

    const requestPromise = construirCatalogo(catalogQuery, cacheKey)
        .finally(() => {
            pendingSearches.delete(cacheKey);
        });

    pendingSearches.set(cacheKey, requestPromise);
    return requestPromise;
};

const descargarCatalogoCompleto = async (catalogQuery) => {
    const cacheKey = crearCacheKey('catalog', catalogQuery);
    const cached = searchCache.get(cacheKey);

    if (cached) {
        return {
            ...cached,
            cacheHit: true,
            stale: false
        };
    }

    const staleCached = staleSearchCache.get(cacheKey);

    // Stale-while-revalidate: se responde inmediatamente con el último
    // catálogo completo y la actualización ocurre sin bloquear al usuario.
    if (staleCached) {
        iniciarActualizacionCatalogo(catalogQuery, cacheKey).catch((error) => {
            console.error(
                'No fue posible actualizar el catálogo en segundo plano:',
                error.message
            );
        });

        return {
            ...staleCached,
            cacheHit: true,
            stale: true,
            refreshing: true
        };
    }

    if (pendingSearches.has(cacheKey)) {
        const pendingResult = await pendingSearches.get(cacheKey);
        return {
            ...pendingResult,
            cacheHit: true,
            stale: false,
            sharedRequest: true
        };
    }

    const result = await iniciarActualizacionCatalogo(catalogQuery, cacheKey);

    return {
        ...result,
        cacheHit: false,
        stale: false
    };
};

const obtenerPrecioComparable = (item) => {
    const venta = Number.parseFloat(item.precios?.venta?.valor || 0);
    const arriendo = Number.parseFloat(item.precios?.arriendo?.valor || 0);
    return Math.max(venta, arriendo);
};

const ordenarPropiedades = (propiedades, orden, dir) => {
    const direccion = dir === 'DESC' ? 'DESC' : 'ASC';

    if (orden === 'asc' || orden === 'desc') {
        const sentido = orden === 'desc' ? -1 : 1;
        propiedades.sort(
            (a, b) =>
                (obtenerPrecioComparable(a) - obtenerPrecioComparable(b)) * sentido
        );
        return;
    }

    if (orden === 'reciente' || orden === 'nuevas') {
        propiedades.sort((a, b) => {
            const idA = Number.parseInt(a.id, 10) || 0;
            const idB = Number.parseInt(b.id, 10) || 0;
            return direccion === 'ASC' ? idA - idB : idB - idA;
        });
        return;
    }

    // Comportamiento por defecto: propiedades más nuevas primero.
    propiedades.sort((a, b) => {
        const idA = Number.parseInt(a.id, 10) || 0;
        const idB = Number.parseInt(b.id, 10) || 0;
        return idB - idA;
    });
};

// Búsqueda paginada con catálogo completo en caché.
router.get('/buscar', async (req, res) => {
    const totalStartedAt = performance.now();

    try {
        const {
            page,
            limit,
            offset,
            catalogQuery,
            orden,
            dir,
            obj,
            comunaCodigo,
            comunaNombre,
            supDesde,
            supHasta
        } = obtenerConsulta(req.query);

        if (!catalogQuery.tipo_prop) {
            return res.status(400).json({
                error: 'Debes indicar el tipo de propiedad.'
            });
        }

        const searchResult = await descargarCatalogoCompleto(catalogQuery);

        const processingStartedAt = performance.now();
        let propiedades = searchResult.items.map(mapearPropiedad);

        // Refuerzo de operación por compatibilidad con resultados mixtos.
        if (obj === '1') {
            propiedades = propiedades.filter(
                (item) => Number.parseFloat(item.precios?.venta?.valor || 0) > 0
            );
        } else if (obj === '2') {
            propiedades = propiedades.filter(
                (item) => Number.parseFloat(item.precios?.arriendo?.valor || 0) > 0
            );
        }

        // La API externa puede ignorar el filtro comuna. Por eso se aplica
        // nuevamente en Node sobre el catálogo base, usando primero el código
        // disponible y, como respaldo, el nombre normalizado de la comuna.
        if (comunaCodigo || comunaNombre) {
            const comunaNombreNormalizada = normalizarTexto(comunaNombre);

            propiedades = propiedades.filter((item) => {
                const codigoItem = limpiarValor(item.ubicacion?.codigoComuna);

                if (comunaCodigo && codigoItem && codigoItem === comunaCodigo) {
                    return true;
                }

                if (comunaNombreNormalizada) {
                    return (
                        normalizarTexto(item.ubicacion?.comuna) ===
                        comunaNombreNormalizada
                    );
                }

                return false;
            });
        }

        // Al tener el catálogo completo, el filtro de superficie y su total
        // quedan correctamente calculados.
        if (Number.isFinite(supDesde)) {
            propiedades = propiedades.filter(
                (item) => item.detalles.superficie >= supDesde
            );
        }

        if (Number.isFinite(supHasta)) {
            propiedades = propiedades.filter(
                (item) => item.detalles.superficie <= supHasta
            );
        }

        ordenarPropiedades(propiedades, orden, dir);

        const totalPropiedades = propiedades.length;
        const totalPaginas = Math.max(1, Math.ceil(totalPropiedades / limit));
        const paginaNormalizada = Math.min(page, totalPaginas);
        const startIndex = (paginaNormalizada - 1) * limit;
        const resultados = propiedades.slice(startIndex, startIndex + limit);

        const processingMs = performance.now() - processingStartedAt;
        const totalMs = performance.now() - totalStartedAt;

        console.table({
            endpoint: '/api/propiedades/buscar',
            cache: searchResult.cacheHit,
            compartida: Boolean(searchResult.sharedRequest),
            apiMs: Math.round(searchResult.apiMs || 0),
            procesamientoMs: Math.round(processingMs),
            totalMs: Math.round(totalMs),
            catalogo: searchResult.items.length,
            totalFiltrado: totalPropiedades,
            comuna: comunaNombre || comunaCodigo || 'GENERAL',
            entregadas: resultados.length,
            pagina: paginaNormalizada,
            totalPaginas,
            peticionesApi: searchResult.peticionesApi || 0,
            catalogoCompleto: searchResult.catalogoCompleto !== false,
            stale: Boolean(searchResult.stale)
        });

        return res.json({
            data: resultados,
            paginacion: {
                totalPropiedades,
                paginaActual: paginaNormalizada,
                totalPaginas,
                propiedadesPorPagina: limit,
                tienePaginaSiguiente: paginaNormalizada < totalPaginas
            },
            meta: {
                cache: searchResult.cacheHit,
                solicitudCompartida: Boolean(searchResult.sharedRequest),
                apiMs: Math.round(searchResult.apiMs || 0),
                procesamientoMs: Math.round(processingMs),
                tiempoTotalMs: Math.round(totalMs),
                catalogoDescargado: searchResult.items.length,
                filtroComuna: comunaNombre || comunaCodigo || null,
                peticionesApi: searchResult.peticionesApi || 0,
                catalogoCompleto: searchResult.catalogoCompleto !== false,
                cacheStale: Boolean(searchResult.stale),
                actualizandoCache: Boolean(searchResult.refreshing)
            }
        });
    } catch (error) {
        console.error('Error en /buscar:', {
            mensaje: error.message,
            status: error.response?.status,
            respuestaAlaluf: error.response?.data,
            parametros: error.response?.config?.params
        });

        return res.status(502).json({
            error: 'No fue posible consultar las propiedades.',
            detalle:
                process.env.NODE_ENV === 'development'
                    ? {
                        mensaje: error.message,
                        statusAlaluf: error.response?.status,
                        respuestaAlaluf: error.response?.data
                    }
                    : undefined
        });
    }
});

const consultarDetallePorId = async (idPropiedad) => {
    const cacheKey = `detail:id:${idPropiedad}`;
    const cached = detailCache.get(cacheKey);

    if (cached) {
        return {
            propiedad: cached,
            cacheHit: true
        };
    }

    if (pendingDetails.has(cacheKey)) {
        return {
            propiedad: await pendingDetails.get(cacheKey),
            cacheHit: true,
            sharedRequest: true
        };
    }

    const requestPromise = (async () => {
        const response = await alalufAxios.get(
            `${BASE_URL_ALALUF}/api/propiedad.php`,
            {
                params: {
                    id_propiedad: idPropiedad
                }
            }
        );

        if (response.status >= 400 || !response.data?.data) {
            return null;
        }

        const propiedad = mapearPropiedad(response.data.data);
        detailCache.set(cacheKey, propiedad);

        if (propiedad.codigo) {
            detailCache.set(`detail:code:${propiedad.codigo}`, propiedad);
        }

        return propiedad;
    })().finally(() => {
        pendingDetails.delete(cacheKey);
    });

    pendingDetails.set(cacheKey, requestPromise);
    const propiedad = await requestPromise;

    return {
        propiedad,
        cacheHit: false
    };
};

// Búsqueda por código comercial.
router.get('/codigo/:codigo', async (req, res) => {
    const codigo = limpiarValor(req.params.codigo);
    const totalStartedAt = performance.now();

    if (!codigo) {
        return res.status(400).json({
            error: 'Código inválido.'
        });
    }

    const codeCacheKey = `detail:code:${codigo}`;
    const cached = detailCache.get(codeCacheKey);

    if (cached) {
        return res.json({
            ...cached,
            meta: {
                cache: true,
                tiempoTotalMs: Math.round(
                    performance.now() - totalStartedAt
                )
            }
        });
    }

    try {
        const searchResponse = await alalufAxios.get(
            `${BASE_URL_ALALUF}/api/res.php`,
            {
                params: {
                    q: codigo,
                    limit: 20,
                    offset: 0
                }
            }
        );

        const matches = extraerItems(searchResponse.data);
        const match = matches.find((item) => {
            return [
                item?.codigo_propiedad,
                item?.codigo_interno,
                item?.id_propiedad
            ].some((value) => String(value || '') === codigo);
        });

        const idPropiedad = match?.id_propiedad || codigo;
        const detailResult = await consultarDetallePorId(idPropiedad);

        if (!detailResult.propiedad) {
            return res.status(404).json({
                error: 'Propiedad no encontrada.'
            });
        }

        detailCache.set(codeCacheKey, detailResult.propiedad);

        return res.json({
            ...detailResult.propiedad,
            meta: {
                cache: detailResult.cacheHit,
                solicitudCompartida: Boolean(detailResult.sharedRequest),
                tiempoTotalMs: Math.round(
                    performance.now() - totalStartedAt
                )
            }
        });
    } catch (error) {
        console.error(
            `Error buscando código ${codigo}:`,
            error.response?.data || error.message
        );

        return res.status(502).json({
            error: 'No fue posible consultar la propiedad.'
        });
    }
});

// Ruta individual por ID interno. Debe ir al final.
router.get('/:id', async (req, res) => {
    const id = limpiarValor(req.params.id);

    try {
        const detailResult = await consultarDetallePorId(id);

        if (!detailResult.propiedad) {
            return res.status(404).json({
                error: 'Propiedad no encontrada.'
            });
        }

        return res.json(detailResult.propiedad);
    } catch (error) {
        console.error(
            `Error obteniendo propiedad ${id}:`,
            error.response?.data || error.message
        );

        return res.status(502).json({
            error: 'No fue posible consultar la propiedad.'
        });
    }
});

module.exports = router;
