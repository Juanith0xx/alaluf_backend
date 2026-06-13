const express = require('express');
const cors = require('cors');
const axios = require('axios'); // 🌟 Añadido para la ruta de diagnóstico
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Importación de Rutas
const propiedadesRoutes = require('./routes/propiedades');
const indicadoresRoutes = require('./routes/indicadores'); 
const crmRoutes = require('./routes/crm.routes');

// Montaje de Rutas
app.use('/api/propiedades', propiedadesRoutes);
app.use('/api/indicadores', indicadoresRoutes); 
app.use('/api', crmRoutes);

// 🌟 RUTA DE DIAGNÓSTICO DINÁMICA AÑADIDA
app.get('/api/conteo-tipos', async (req, res) => {
    try {
        // Capturamos los parámetros dinámicos de la URL (ej: tipo_prop=1A, obj=2)
        const { tipo_prop, obj } = req.query;

        // Consultamos a la API de Alaluf con esos parámetros
        const response = await axios.get('https://alaluf.cl/api/res.php', {
            params: { tipo_prop: tipo_prop, obj: obj, limit: 1000 },
            headers: {
                'X-API-KEY': process.env.ALALUF_API_KEY,
                'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });

        const propiedades = response.data?.data || [];
        const conteo = {};

        // Recorremos y agrupamos por el nombre del tipo de propiedad
        propiedades.forEach(prop => {
            const tipo = prop.desc_tipo_prop ? prop.desc_tipo_prop.trim() : "Sin especificar";
            if (!conteo[tipo]) {
                conteo[tipo] = 0;
            }
            conteo[tipo]++;
        });

        // Retornamos el JSON con la estructura exacta que necesitas
        res.json({
            mensaje: `Resultados para tipo_prop=${tipo_prop} & obj=${obj}`,
            total_propiedades_revisadas: propiedades.length,
            desglose_por_tipo: conteo
        });

    } catch (error) {
        console.error("Error en la ruta de diagnóstico:", error.message);
        res.status(500).json({ error: "No se pudo realizar el conteo con Alaluf" });
    }
});

// Ruta raíz de comprobación
app.get('/', (req, res) => {
    res.send('Servidor Alaluf Bridge operativo 🚀');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});