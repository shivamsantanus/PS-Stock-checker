// Scratch investigation script - Croma PS5 product page.
// Goal: confirm/refute the prior "403 Access Denied on plain page load" finding,
// and if it loads, find a stable stock selector.
const { chromium } = require("playwright");

const URL = "https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320";
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
  let status = null;
  page.on("response", (res) => {
    if (res.url() === URL || (status === null && res.request().resourceType() === "document")) {
      status = res.status();
    }
  });
  try {
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("HTTP status:", resp && resp.status());
    await page.waitForTimeout(2000);
    const title = await page.title();
    console.log("Page title:", title);
    const bodyText = await page.locator("body").innerText().catch(() => "<no body text>");
    console.log("Body text length:", bodyText.length);
    console.log("Body text head:", bodyText.slice(0, 500));

    // Check for a JSON-LD block like Flipkart has.
    const jsonLdCount = await page.locator("script[type='application/ld+json']").count();
    console.log("JSON-LD script count:", jsonLdCount);
    for (let i = 0; i < jsonLdCount; i++) {
      const txt = await page.locator("script[type='application/ld+json']").nth(i).innerText();
      if (txt.includes("availability") || txt.includes("Product")) {
        console.log(`JSON-LD[${i}] (has availability/Product):`, txt.slice(0, 1000));
      }
    }

    // Look for add-to-cart / out-of-stock text anywhere.
    const addToCartCount = await page.getByText(/add to cart/i).count();
    const outOfStockCount = await page.getByText(/out of stock|sold out|notify me/i).count();
    console.log("‘add to cart’ matches:", addToCartCount, " | OOS-like matches:", outOfStockCount);
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
