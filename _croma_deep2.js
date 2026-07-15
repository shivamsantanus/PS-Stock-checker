// Scratch investigation - does visiting croma.com homepage first (to pick up
// Akamai bot-manager cookies like _abck/bm_sz) let a subsequent product page
// load succeed, instead of hitting the product URL cold?
const { chromium } = require("playwright");

const HOME = "https://www.croma.com/";
const PRODUCT = "https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320";
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
    const homeResp = await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Homepage status:", homeResp && homeResp.status());
    console.log("Homepage title:", await page.title());
    await page.waitForTimeout(3000);

    const cookies = await context.cookies();
    console.log(
      "Cookies after homepage visit:",
      cookies.map((c) => c.name).join(", ")
    );

    const prodResp = await page.goto(PRODUCT, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Product status (after homepage warm-up):", prodResp && prodResp.status());
    console.log("Product title:", await page.title());
    const bodyText = await page.locator("body").innerText().catch(() => "<none>");
    console.log("Body head:", bodyText.slice(0, 300));
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
