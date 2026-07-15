// Scratch investigation - Reliance Digital PS5 product page.
// Goal: find the real pincode input + apply button selectors, and the real
// stock/add-to-cart selector once the Vue app has actually hydrated.
const { chromium } = require("playwright");

const URL = "https://www.reliancedigital.in/product/sony-playstation-ps5-slim-console-luh1rv-7537998";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
  try {
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("HTTP status:", resp && resp.status());
    console.log("Title:", await page.title());

    // Give the Vue SPA real time to hydrate instead of a short fixed wait.
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch((e) => console.log("networkidle wait:", e.message));
    await page.waitForTimeout(3000);

    // Dump every data-testid / id on the page to find real anchors, like the
    // Instamart deep-dive scripts did.
    const testIds = await page.locator("[data-testid]").evaluateAll((els) =>
      Array.from(new Set(els.map((e) => e.getAttribute("data-testid"))))
    );
    console.log("data-testid values (", testIds.length, "):", testIds.join(", "));

    const ids = await page.locator("[id]").evaluateAll((els) =>
      Array.from(new Set(els.map((e) => e.id))).filter((id) => id)
    );
    console.log("element ids (", ids.length, "):", ids.slice(0, 80).join(", "));

    // Look for pincode-related inputs/buttons by text/placeholder.
    const pincodeInputs = await page.locator("input").evaluateAll((els) =>
      els.map((e) => ({
        placeholder: e.placeholder,
        name: e.name,
        id: e.id,
        className: e.className,
      }))
    );
    console.log("All <input> elements:", JSON.stringify(pincodeInputs, null, 2));

    const pincodeButtons = await page.getByText(/pincode|pin code|delivery|check availability|apply/i).all();
    console.log("Text-matched pincode/delivery elements count:", pincodeButtons.length);
    for (const el of pincodeButtons.slice(0, 20)) {
      const txt = await el.innerText().catch(() => "");
      const tag = await el.evaluate((e) => e.tagName).catch(() => "?");
      console.log(` - <${tag}> "${txt.slice(0, 60)}"`);
    }

    // Stock/CTA text.
    const addToCart = await page.getByText(/add to cart|notify me|out of stock|sold out|buy now/i).all();
    console.log("Stock-CTA-matched elements count:", addToCart.length);
    for (const el of addToCart.slice(0, 20)) {
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
