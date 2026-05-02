const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Rutas
const propiedadesRoutes = require('./routes/propiedades');
app.use('/api/propiedades', propiedadesRoutes);

app.get('/', (req, res) => {
    res.send('Servidor Alaluf Bridge operativo 🚀');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});