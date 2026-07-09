const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  try {
    await page.goto('https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const allCookies = await context.cookies();
    console.log('ALL COOKIES:', JSON.stringify(allCookies.map(c => ({name: c.name, value: c.value.slice(0,60), domain: c.domain})), null, 2));

    const ls = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = (localStorage.getItem(k) || '').slice(0, 150);
      }
      return out;
    });
    console.log('LOCALSTORAGE:', JSON.stringify(ls, null, 2));
  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
