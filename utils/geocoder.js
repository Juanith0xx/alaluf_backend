const axios = require('axios');

const obtenerCoordenadas = async (direccion) => {
  const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
  
  // Limpiamos la dirección y la codificamos para URL
  const query = encodeURIComponent(direccion);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=cl`;

  try {
    const response = await axios.get(url);
    
    if (response.data.features && response.data.features.length > 0) {
      const [lng, lat] = response.data.features[0].center;
      return { lat, lng };
    }
    
    // Si no encuentra nada, devolvemos null o coordenadas por defecto (Santiago)
    return { lat: -33.4489, lng: -70.6693 }; 
  } catch (error) {
    console.error("Error en Geocoding:", error.message);
    return null;
  }
};

module.exports = { obtenerCoordenadas };