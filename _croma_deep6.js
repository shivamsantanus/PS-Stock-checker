// Scratch investigation #6 - Croma ground truth: for each PS5 PDP, capture
// (a) the real disabled state of the Buy Now / Add to Cart buttons and any
// OOS badge text, (b) every api.croma.com XHR request headers + response
// body, especially pricing-services (to learn the correct 'channel' header
// and find the field the UI derives buy-ability from).
const { chromium } = require("playwright");

const PRODUCTS = {
  "321320": "https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320",
  "316841": "https://www.croma.com/sony-playstation-5-1tb-ssd-digital-edition-slim-gaming-console-white-/p/316841",
};

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  page.on("response", async (res) => {
    const u = res.url();
    if (/api\.croma\.com\/(pricing-services|inventory|product\/allchannels)/.test(u)) {
      const reqHeaders = res.request().headers();
      const interesting = Object.fromEntries(
        Object.entries(reqHeaders).filter(([k]) => !/^(sec-|accept|user-agent|referer|cookie|origin)/.test(k))
      );
      let body = "";
      try {
        body = (await res.text()).slice(0, 900);
      } catch {}
      console.log("\n--- API:", res.status(), u.slice(0, 140));
      console.log("    req hdrs:", JSON.stringify(interesting));
      if (res.request().method() === "POST") console.log("    req body:", (res.request().postData() || "").slice(0, 400));
      console.log("    res body:", body);
    }
  });

  for (const [code, url] of Object.entries(PRODUCTS)) {
    console.log("\n================ PDP", code, "================");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(4000);

    const buyBox = await page
      .locator("button.pdp-add-to-cart, button[class*='BuyNow'], button[class*='buyNow']")
      .evaluateAll((els) =>
        els.map((e) => ({
          txt: (e.innerText || "").trim(),
          cls: e.className,
          disabledProp: e.disabled,
          ariaDisabled: e.getAttribute("aria-disabled"),
          pointerEvents: getComputedStyle(e).pointerEvents,
          opacity: getComputedStyle(e).opacity,
        }))
      );
    console.log("BUY BOX:", JSON.stringify(buyBox, null, 2));

    const badges = await page
      .getByText(/out of stock|sold out|notify me|coming soon|currently unavailable/i)
      .evaluateAll((els) =>
        els.filter((e) => e.offsetParent).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 70), txt: (e.innerText || "").trim().slice(0, 60) }))
      )
      .catch(() => []);
    console.log("OOS BADGES:", JSON.stringify(badges));
  }

  await browser.close();
})();
