const { chromium } = require('playwright');

const variants = [
  'https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR?lat=30.7333&lng=76.7794',
  'https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR?latitude=30.7333&longitude=76.7794',
  'https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR?pincode=147002',
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const url of variants) {
    const page = await (await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    })).newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      const loc = await page.evaluate(() => {
        const s = window.___INITIAL_STATE___;
        return s ? s.userLocation : null;
      });
      console.log(url, '=>', JSON.stringify(loc));
    } catch (e) {
      console.log(url, '=> ERROR', e.message);
    } finally {
      await page.close();
    }
  }
  await browser.close();
})();
