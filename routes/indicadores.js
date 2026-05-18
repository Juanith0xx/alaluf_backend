const express = require("express");
const router = express.Router();
const { getUfValue } = require("../utils/ufService");

// GET /api/indicadores/uf
router.get("/uf", async (req, res) => {
  try {
    const dataUf = await getUfValue();
    return res.json({ success: true, ...dataUf });
  } catch (error) {
    return res.status(502).json({ 
      success: false, 
      message: "Indicador económico no disponible en este momento" 
    });
  }
});

module.exports = router;