const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  const url = "https://www.amazon.in/Grand-Theft-Auto-Release-Date/dp/B0F4XLZ82F";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    console.log("TITLE:", await page.title());
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.log(bodyText.slice(0, 3000));
  } finally {
    await browser.close();
  }
})();
