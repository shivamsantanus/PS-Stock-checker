// Scratch investigation #5 - Reliance Digital FALSE POSITIVE hunt.
// The sizes API says sellable:true qty 9, but the real PDP shows no stock.
// Load the PDP with a real browser, capture EVERY /api/service/application
// response, and dump the hydrated buy-box, to find the field the page's own
// out-of-stock rendering is driven by.
const { chromium } = require("playwright");

const URL = "https://www.reliancedigital.in/product/sony-playstation-ps5-slim-console-luh1rv-7537998";

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  page.on("response", async (res) => {
    const u = res.url();
    if (/reliancedigital\.in\/api\/service/.test(u)) {
      let body = "";
      try {
        body = await res.text();
      } catch {}
      // Print compact: url + first 500 chars, but flag availability-ish fields.
      const flags = [];
      for (const key of ["sellable", "is_available", "out_of_stock", "quantity", "purchasable", "availability"]) {
        const m = body.match(new RegExp('"' + key + '"\\s*:\\s*("[^"]*"|[^,}\\]]+)', "g"));
        if (m) flags.push(...m.slice(0, 6));
      }
      console.log("\nAPI:", res.status(), u.replace("https://www.reliancedigital.in/api/service/application", "..."));
      if (flags.length) console.log("   flags:", flags.join("  "));
      else console.log("   body:", body.slice(0, 220));
    }
  });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  // Scroll a bit to trigger lazy sections, then wait for late hydration.
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(5000);

  console.log("\n---------------- BUY BOX DUMP ----------------");
  const productRight = await page.locator(".product-right-container").innerText().catch(() => "<not found>");
  console.log("product-right-container text:\n", productRight.slice(0, 800));

  const ctas = await page
    .getByText(/add to cart|notify me|out of stock|sold out|buy now|coming soon|unavailable/i)
    .evaluateAll((els) =>
      els.map((e) => ({
        tag: e.tagName,
        cls: String(e.className).slice(0, 70),
        txt: (e.innerText || "").trim().slice(0, 60),
        visible: !!e.offsetParent,
      }))
    )
    .catch(() => []);
  console.log("CTA-ish elements:", JSON.stringify(ctas, null, 2));

  await browser.close();
})();
