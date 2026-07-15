const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  const url = "https://www.amazon.in/Grand-Theft-Auto-Release-Date/dp/B0F4XLZ82F";
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    console.log("status:", resp.status());
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.log("body length:", bodyText.length);
    console.log("body snippet:", bodyText.slice(0, 500));
    const isCaptcha = /sorry.*something went wrong|enter the characters you see|api-services-support/i.test(bodyText);
    console.log("looks like captcha/block page:", isCaptcha);
    await page.waitForTimeout(1500);
    for (const sel of ["#availability", "#buybox"]) {
      const count = await page.locator(sel).count();
      if (count) {
        const txt = await page.locator(sel).first().innerText().catch(() => "");
        console.log(`${sel}: ${JSON.stringify(txt.slice(0,400))}`);
      } else {
        console.log(sel, "not present");
      }
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
