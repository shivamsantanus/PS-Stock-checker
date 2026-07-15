const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const URL = "https://www.amazon.in/Grand-Theft-Auto-Standard-PlayStation/dp/B0H6X8VNQC";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  try {
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    console.log("status:", resp.status());
    await page.waitForTimeout(2500);
    console.log("Title:", await page.title());
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.log("body length:", bodyText.length);
    console.log(bodyText.slice(0, 2500));
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
