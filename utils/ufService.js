// Variable en memoria a nivel de módulo para la caché
let cachedUF = null;
let lastFetchDate = null;

const getUfValue = async () => {
  const hoy = new Date().toISOString().split("T")[0]; // Formato YYYY-MM-DD

  // 🌟 Si ya la consultamos hoy, retornamos el valor al instante sin pegarle a la API externa
  if (cachedUF && lastFetchDate === hoy) {
    return { valor: cachedUF, source: "cache" };
  }

  try {
    // Usamos el fetch global nativo de Node.js
    const response = await fetch("https://mindicador.cl/api/uf");
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // mindicador.cl entrega el valor limpio en data.serie[0].valor (ej: 37950.42)
    const valorUf = data.serie[0].valor;

    // Guardamos en la caché global del servidor
    cachedUF = valorUf;
    lastFetchDate = hoy;

    return { valor: valorUf, source: "api" };

  } catch (error) {
    console.error("⚠️ Error en ufService consultando mindicador.cl:", error.message);

    // Fallback: Si la API externa falla pero tenemos un valor antiguo en caché, lo entregamos para no romper el frontend
    if (cachedUF) {
      return { valor: cachedUF, source: "fallback_cache" };
    }
    
    throw error;
  }
};

module.exports = { getUfValue };