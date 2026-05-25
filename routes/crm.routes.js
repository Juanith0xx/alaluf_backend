const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/webhook/crm', async (req, res) => {
  try {
    // 1. Extraemos los datos que nos envía el frontend (React)
    const { nombre, rut, email, telefono, mensaje, origen } = req.body;

    // 2. Validación básica de seguridad en el backend
    if (!nombre || !rut || !email) {
      return res.status(400).json({ 
        success: false, 
        error: "Los campos nombre, rut y email son obligatorios." 
      });
    }

    // 3. Preparamos el paquete de datos (Payload) para el CRM en PHP
    const payload = {
      nombre,
      rut,
      email,
      telefono: telefono || "",
      mensaje: mensaje || "",
      // Si por alguna razón el front no envía el origen, asignamos uno genérico
      origen: origen || "Formulario Web (Desconocido)" 
    };

    // 4. Hacemos la petición POST al CRM del cliente
    const response = await axios.post(process.env.CRM_PHP_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        // Enviamos el token secreto para que el PHP valide que somos nosotros
        'Authorization': `Bearer ${process.env.CRM_SECRET_TOKEN}`
      }
    });

    // 5. Respondemos a React que todo fue un éxito
    res.status(200).json({ 
      success: true, 
      message: "Lead derivado exitosamente al CRM",
      crm_response: response.data 
    });

  } catch (error) {
    // Si el servidor PHP falla, está caído o rechaza el token, lo capturamos aquí
    console.error("Error al enviar lead al CRM:", error.response?.data || error.message);
    
    res.status(500).json({ 
      success: false, 
      error: "Hubo un problema al procesar la solicitud con el CRM." 
    });
  }
});

module.exports = router;