const https = require('https');

https.get('https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR?lat=30.3398&lng=76.3869', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
}, (res) => {
  console.log('STATUS:', res.statusCode);
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const idx = data.indexOf('___INITIAL_STATE___');
    console.log('LEN:', data.length);
    console.log('FOUND AT:', idx);
    if (idx >= 0) {
      console.log(data.slice(idx - 50, idx + 400));
    } else {
      console.log('SAMPLE START:', data.slice(0, 500));
    }
  });
}).on('error', e => console.log('ERROR', e.message));
