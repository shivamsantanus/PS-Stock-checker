// Scratch investigation #4 - capture the exact request headers/cookies the
// Reliance Digital frontend sends to its own /sizes/ availability API, to
// see whether they're static (replayable via axios) or session-bound.
const { chromium } = require("playwright");

const URL = "https://www.reliancedigital.in/product/sony-playstation-ps5-slim-console-luh1rv-7537998";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PINCODE = process.argv[2] || "560075";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-US" });
  const page = await context.newPage();

  page.on("request", (req) => {
    if (/\/sizes\/|localities\/pincode/i.test(req.url())) {
      console.log("REQ:", req.method(), req.url());
      console.log("REQ HEADERS:", JSON.stringify(req.headers(), null, 2));
    }
  });
  page.on("response", async (res) => {
    if (/\/sizes\//i.test(res.url())) {
      console.log("RES:", res.status(), res.url());
      const body = await res.text().catch(() => "<unreadable>");
      console.log("RES BODY:", body.slice(0, 2000));
    }
  });

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.locator(".delivery-pincode-input").first().fill(PINCODE);
    await page.waitForTimeout(800);
    await page.locator(".delivery-pincode-input").first().press("Enter");
    await page.waitForTimeout(8000);
    const cookies = await context.cookies("https://www.reliancedigital.in");
    console.log("COOKIES:", JSON.stringify(cookies.map((c) => ({ name: c.name, value: c.value.slice(0, 60) })), null, 2));
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
