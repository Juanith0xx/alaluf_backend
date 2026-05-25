const express = require('express');
const cors = require('cors');
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

// Ruta raíz de comprobación
app.get('/', (req, res) => {
    res.send('Servidor Alaluf Bridge operativo 🚀');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});