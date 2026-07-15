// Follow-up: dump FULL rendered body text for both pages (previous run's
// truncation for PS5 - only 8277 chars - suggests either a bot-check page
// or slow client render; also drill into the "Notify Me" CTA on Motorola
// Edge 70 Max found in script3 to see if it's the PRIMARY buy button.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PAGES = [
  {
    label: "PS5 console (current target)",
    url: "https://www.flipkart.com/sony-playstation5-console-slim-cfi-2008a01x-1024-gb/p/itm89489e2adcd2c",
  },
  {
    label: "Motorola Edge 70 Max",
    url: "https://www.flipkart.com/motorola-edge-70-max-pantone-dark-shadow-256-gb/p/itma23e20d630c2e",
  },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const { label, url } of PAGES) {
    console.log(`\n\n===================== ${label} =====================`);
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(3000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log("Rendered body text length:", bodyText.length);
      console.log("----- FULL TEXT -----");
      console.log(bodyText);
    } catch (err) {
      console.log("ERROR:", err.message);
      try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log("Partial body text length:", bodyText.length);
        console.log(bodyText);
      } catch (e2) {}
    } finally {
      await context.close();
    }
  }
  await browser.close();
})();
