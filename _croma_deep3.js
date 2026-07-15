// Scratch investigation #3 - Croma: test whether the Akamai 403 keys on
// headless client hints (sec-ch-ua: "HeadlessChrome") by disabling client
// hints / automation flags, and probe api.croma.com directly.
const { chromium } = require("playwright");

const PRODUCT = "https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=UserAgentClientHint",
    ],
  });
  const context = await browser.newContext({ userAgent: UA, locale: "en-US" });
  const page = await context.newPage();
  page.on("request", (req) => {
    if (/api\.croma\.com/.test(req.url())) console.log("API REQ:", req.method(), req.url().slice(0, 160));
  });
  page.on("response", (res) => {
    if (/api\.croma\.com/.test(res.url())) console.log("API RES:", res.status(), res.url().slice(0, 160));
  });
  try {
    const resp = await page.goto(PRODUCT, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Product status (client hints disabled):", resp && resp.status());
    console.log("Title:", await page.title());
    if (resp && resp.status() === 200) {
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const body = await page.locator("body").innerText().catch(() => "");
      console.log("Body head:", body.slice(0, 400));
      const ctas = await page.getByText(/add to cart|notify me|out of stock|sold out|buy now|coming soon/i).all();
      console.log("CTA matches:", ctas.length);
      for (const el of ctas.slice(0, 10)) {
        const info = await el
          .evaluate((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 70), txt: (e.innerText || "").trim().slice(0, 50), visible: !!e.offsetParent }))
          .catch(() => null);
        if (info) console.log(" -", JSON.stringify(info));
      }
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
