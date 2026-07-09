const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    geolocation: { latitude: 30.7333, longitude: 76.7794 }, // Patiala approx
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  try {
    await page.goto('https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('BODY TEXT (with geolocation granted):\n', bodyText);

    // look for window.__INITIAL_STATE__ or similar embedded JSON
    const stateKeys = await page.evaluate(() => Object.keys(window).filter(k => /state|initial|preload|__/i.test(k)));
    console.log('WINDOW STATE-ISH KEYS:', stateKeys);

    // check scripts for JSON blobs
    const scripts = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('script:not([src])').forEach(s => {
        const t = s.textContent || '';
        if (t.length > 200 && (t.includes('lat') || t.includes('address') || t.includes('storeId') || t.includes('sold'))) {
          results.push(t.slice(0, 300));
        }
      });
      return results.slice(0, 5);
    });
    console.log('INLINE SCRIPTS SAMPLE:', JSON.stringify(scripts, null, 2));
  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
