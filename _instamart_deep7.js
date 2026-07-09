const https = require('https');

function fetchState(lat, lng) {
  return new Promise((resolve, reject) => {
    https.get(`https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR?lat=${lat}&lng=${lng}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const start = data.indexOf('window.___INITIAL_STATE___ = ') + 'window.___INITIAL_STATE___ = '.length;
          const end = data.indexOf('</script>', start);
          let jsonStr = data.slice(start, end).trim();
          if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);
          const state = JSON.parse(jsonStr);
          resolve({
            status: res.statusCode,
            userLocation: state.userLocation,
            storeId: state.storeDetailsV2 && state.storeDetailsV2.storeId,
            storeServiceable: state.storeDetailsV2 && state.storeDetailsV2.storeServiceable,
            itemAvailability: state.productV2 && state.productV2.itemData && {
              inStock: state.productV2.itemData.inStock,
              available: state.productV2.itemData.available,
              variations: state.productV2.itemData.variations ? state.productV2.itemData.variations.map(v => ({inStock: v.inStock, quantity: v.quantity})) : undefined,
              raw: JSON.stringify(state.productV2.itemData).slice(0, 300),
            },
          });
        } catch (e) {
          resolve({ status: res.statusCode, error: e.message, sample: data.slice(0,200) });
        }
      });
    }).on('error', e => reject(e));
  });
}

const cities = [
  { city: 'Patiala', pincode: '147002', lat: 30.3398, lng: 76.3869 },
  { city: 'Cuttack', pincode: '753004', lat: 20.4625, lng: 85.8828 },
  { city: 'Gurugram', pincode: '122098', lat: 28.4595, lng: 77.0266 },
  { city: 'Bhubaneswar', pincode: '751012', lat: 20.2961, lng: 85.8245 },
  { city: 'Dehradun', pincode: '248001', lat: 30.3165, lng: 78.0322 },
  { city: 'Lucknow', pincode: '226016', lat: 26.8467, lng: 80.9462 },
  { city: 'Bangalore', pincode: '560075', lat: 12.9716, lng: 77.5946 },
  { city: 'Faridabad', pincode: '121010', lat: 28.4089, lng: 77.3178 },
  { city: 'Varanasi', pincode: '221010', lat: 25.3176, lng: 82.9739 },
  { city: 'Amb', pincode: '177211', lat: 31.5, lng: 76.2833 },
];

(async () => {
  for (const c of cities) {
    try {
      const r = await fetchState(c.lat, c.lng);
      console.log(c.city, c.pincode, '=>', JSON.stringify(r));
    } catch (e) {
      console.log(c.city, c.pincode, '=> ERROR', e.message);
    }
  }
})();
