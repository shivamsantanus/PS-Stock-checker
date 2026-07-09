const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  })).newPage();
  try {
    await page.goto('https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const state = await page.evaluate(() => {
      try {
        const s = window.___INITIAL_STATE___;
        return JSON.stringify(s).slice(0, 200) + ' ...LEN=' + JSON.stringify(s).length;
      } catch(e) { return 'ERR:' + e.message; }
    });
    console.log('STATE PREVIEW:', state);

    const topKeys = await page.evaluate(() => Object.keys(window.___INITIAL_STATE___ || {}));
    console.log('TOP KEYS:', topKeys);

    // Search recursively for lat/lng/pincode/address related keys
    const found = await page.evaluate(() => {
      const s = window.___INITIAL_STATE___;
      const hits = [];
      function walk(obj, path, depth) {
        if (depth > 6 || hits.length > 40) return;
        if (obj && typeof obj === 'object') {
          for (const k of Object.keys(obj)) {
            const p = path + '.' + k;
            if (/lat|lng|pincode|address|storeId|geo/i.test(k)) {
              let val = obj[k];
              if (typeof val === 'object') val = '[object]';
              hits.push(p + ' = ' + val);
            }
            walk(obj[k], p, depth+1);
          }
        }
      }
      walk(s, 'STATE', 0);
      return hits;
    });
    console.log('MATCHING KEYS:', JSON.stringify(found, null, 2));
  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
