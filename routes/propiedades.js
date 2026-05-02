const express = require('express');
const router = express.Router();
const axios = require('axios');

const alalufAxios = axios.create({
    headers: {
        'X-API-KEY': process.env.ALALUF_API_KEY,
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    },
    // AJUSTE 1: Aumentamos el timeout a 30 segundos
    timeout: 30000 
});

const BASE_URL_ALALUF = "https://alaluf.cl";
const SISTEMA_URL_ALALUF = "https://sistema.alaluf.com"; 

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

    return {
        id: prop.id_propiedad,          
        codigo: prop.codigo_interno,    
        titulo: prop.desc_tipo || "Propiedad",
        operacion: prop.desc_obj || "Venta / Arriendo",
        ubicacion: {
            comuna: prop.com_nombre || "Sin Comuna",
            sector: prop.sector_cercano || "Sin Sector",
            region: prop.region || "Metropolitana"
        },
        coords: {
            lat: parseFloat(prop.latitud) || null,
            lng: parseFloat(prop.longitud) || null
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

// Rutas de la API
router.get('/buscar', async (req, res) => {
    // AJUSTE 2: Bajamos el limit por defecto de 50 a 20 para acelerar la respuesta
    const { tipo_prop, obj, comuna, limit = 20, offset = 0 } = req.query;
    
    try {
        const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/res.php`, {
            params: { tipo_prop, obj, comuna, limit, offset }
        });
        const rawDataArray = response.data?.data || [];
        res.json(rawDataArray.map(mapearPropiedad));
    } catch (error) {
        // Log detallado para saber si el error fue timeout o conexión
        console.error(`[ALALUF ERROR] ${error.code === 'ECONNABORTED' ? 'Timeout excedido' : error.message}`);
        res.status(error.code === 'ECONNABORTED' ? 504 : 500).json({ 
            error: "La API de Alaluf tardó demasiado en responder",
            detalle: error.code
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const response = await alalufAxios.get(`${BASE_URL_ALALUF}/api/propiedad.php`, {
            params: { id_propiedad: req.params.id }
        });
        const rawData = response.data?.data;
        if (!rawData) return res.status(404).json({ error: "Propiedad no encontrada" });
        res.json(mapearPropiedad(rawData));
    } catch (error) {
        res.status(500).json({ error: "Error en la ficha" });
    }
});

module.exports = router;