const https = require('https');

function extractInitialState(html) {
  const marker = 'window.___INITIAL_STATE___ = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const braceStart = html.indexOf('{', start);
  let depth = 0, inStr = false, strCh = null, esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === strCh) { inStr = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return html.slice(braceStart, i + 1);
      }
    }
  }
  return null;
}

function fetchState(lat, lng) {
  return new Promise((resolve, reject) => {
    https.get(`https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR?lat=${lat}&lng=${lng}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const jsonStr = extractInitialState(data);
          const state = JSON.parse(jsonStr);
          resolve({
            status: res.statusCode,
            userLocation: state.userLocation,
            storeId: state.storeDetailsV2 && state.storeDetailsV2.storeId,
            storeDetailsKeys: state.storeDetailsV2 ? Object.keys(state.storeDetailsV2) : null,
            itemDataKeys: state.productV2 && state.productV2.itemData ? Object.keys(state.productV2.itemData) : null,
            itemData: state.productV2 && state.productV2.itemData,
          });
        } catch (e) {
          resolve({ status: res.statusCode, error: e.message });
        }
      });
    }).on('error', e => reject(e));
  });
}

const cities = [
  { city: 'Patiala', pincode: '147002', lat: 30.3398, lng: 76.3869 },
  { city: 'Bhubaneswar', pincode: '751012', lat: 20.2961, lng: 85.8245 },
  { city: 'Bangalore', pincode: '560075', lat: 12.9716, lng: 77.5946 },
];

(async () => {
  for (const c of cities) {
    try {
      const r = await fetchState(c.lat, c.lng);
      console.log('===', c.city, c.pincode, '===');
      console.log(JSON.stringify(r, null, 2).slice(0, 3000));
    } catch (e) {
      console.log(c.city, c.pincode, '=> ERROR', e.message);
    }
  }
})();
