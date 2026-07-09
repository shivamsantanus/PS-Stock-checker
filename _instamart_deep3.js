const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  })).newPage();
  const calls = [];
  page.on('request', req => {
    const url = req.url();
    if (/swiggy\.com\/(api|dapi)/i.test(url)) {
      calls.push({ url, method: req.method(), headers: req.headers() });
    }
  });
  try {
    await page.goto('https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log('SWIGGY API/DAPI CALLS:');
    calls.forEach(c => console.log(c.method, c.url));
  } catch (e) {
    console.log('ERROR:', e.message);
    console.log('CALLS SO FAR:');
    calls.forEach(c => console.log(c.method, c.url));
  } finally {
    await browser.close();
  }
})();
