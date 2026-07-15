const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const URL = "https://www.amazon.in/Grand-Theft-Auto-Standard-PlayStation/dp/B0H6X8VNQC";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch((e) => console.log("networkidle:", e.message));
    await page.waitForTimeout(2000);

    for (const sel of ["#availability", "#buybox", "#addToCart", "#buyNow", "#submit\.buy-now", "#one-click-button"]) {
      const count = await page.locator(sel).count();
      if (count) {
        const txt = await page.locator(sel).first().innerText().catch((e) => `<err ${e.message}>`);
        console.log(`${sel} (${count}): ${JSON.stringify(txt.slice(0, 250))}`);
      } else {
        console.log(sel, ": not present");
      }
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
