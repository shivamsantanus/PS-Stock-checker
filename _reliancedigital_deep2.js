// Scratch investigation #2 - Reliance Digital: fill pincode, click the
// "Apply" <p> element, then dump the buy-box / CTA area after hydration.
const { chromium } = require("playwright");

const URL = "https://www.reliancedigital.in/product/sony-playstation-ps5-slim-console-luh1rv-7537998";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PINCODE = process.argv[2] || "560075";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  const page = await context.newPage();
  // Log any availability/serviceability API calls the pincode apply fires.
  page.on("response", (res) => {
    const u = res.url();
    if (/pin|avail|service|deliver|inventory|stock/i.test(u) && !/\.(js|css|png|svg|woff)/.test(u)) {
      console.log("NET:", res.status(), u.slice(0, 160));
    }
  });
  try {
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("HTTP status:", resp && resp.status());
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // --- Before pincode: dump the product buy-box area (#product section) ---
    const productText = await page.locator("#product").innerText().catch(() => "<no #product>");
    console.log("---- #product text BEFORE pincode ----");
    console.log(productText.slice(0, 1200));

    // Dump all button-ish elements in #product with their classes.
    const buttons = await page
      .locator("#product button, #product [class*='btn'], #product [class*='cart'], #product [class*='buy'], #product [class*='notify']")
      .evaluateAll((els) =>
        els.map((e) => ({ tag: e.tagName, cls: e.className, txt: (e.innerText || "").trim().slice(0, 50) }))
      );
    console.log("---- #product button-ish elements ----");
    console.log(JSON.stringify(buttons, null, 2));

    // --- Apply pincode ---
    await page.locator(".delivery-pincode-input").fill(PINCODE);
    await page.waitForTimeout(1000);
    // The "Apply" control is a <p>; click by text within the delivery section.
    await page.locator("#delivery p", { hasText: /^Apply$/i }).first().click();
    console.log("Clicked Apply for pincode", PINCODE);
    await page.waitForTimeout(6000);

    // --- After pincode ---
    const deliveryText = await page.locator("#delivery").innerText().catch(() => "<no #delivery>");
    console.log("---- #delivery text AFTER apply ----");
    console.log(deliveryText.slice(0, 800));

    const productTextAfter = await page.locator("#product").innerText().catch(() => "<no #product>");
    console.log("---- #product text AFTER apply ----");
    console.log(productTextAfter.slice(0, 1200));

    const buttonsAfter = await page
      .locator("#product button, #product [class*='btn'], #product [class*='cart'], #product [class*='buy'], #product [class*='notify']")
      .evaluateAll((els) =>
        els.map((e) => ({ tag: e.tagName, cls: e.className, txt: (e.innerText || "").trim().slice(0, 50) }))
      );
    console.log("---- #product button-ish elements AFTER apply ----");
    console.log(JSON.stringify(buttonsAfter, null, 2));

    // Page-wide CTA sweep.
    const ctas = await page.getByText(/add to cart|notify me|out of stock|sold out|buy now|coming soon/i).all();
    console.log("Page-wide stock-CTA matches:", ctas.length);
    for (const el of ctas.slice(0, 15)) {
      const txt = await el.innerText().catch(() => "");
      const tag = await el.evaluate((e) => e.tagName).catch(() => "?");
      const cls = await el.evaluate((e) => e.className).catch(() => "");
      console.log(` - <${tag} class="${String(cls).slice(0, 80)}"> "${txt.slice(0, 60)}"`);
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
