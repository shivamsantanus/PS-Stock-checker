// Follow-up scratch script (Playwright): render the actual pages and look
// at the VISIBLE, JS-rendered buy-box for "Notify Me" / "Coming Soon" /
// launch-date text, since some buy-box text on Flipkart is client-rendered
// and might not show up in the raw jsonLD at all.
//
// Targets:
//  1) The PS5 console PDP (current target) - what does its buy box say?
//  2) Motorola Edge 70 Max (PANTONE Dark Shadow, 256 GB) - jsonLD showed
//     OutOfStock + zero reviews (script2 run) which smells like a genuinely
//     new/just-launched-or-about-to-launch phone. Sanity check what its
//     rendered buy box actually shows.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PAGES = [
  {
    label: "PS5 console (current target)",
    url: "https://www.flipkart.com/sony-playstation5-console-slim-cfi-2008a01x-1024-gb/p/itm89489e2adcd2c",
  },
  {
    label: "Motorola Edge 70 Max (sanity check - jsonLD showed OutOfStock, 0 reviews)",
    url: "https://www.flipkart.com/motorola-edge-70-max-pantone-dark-shadow-256-gb/p/itma23e20d630c2e",
  },
];

const PHRASES = [
  "notify me",
  "coming soon",
  "pre-order",
  "preorder",
  "pre order",
  "launching on",
  "launch date",
  "sold out",
  "out of stock",
  "currently unavailable",
  "will be back",
  "restock",
  "expected",
  "coming to flipkart",
  "get it as soon as",
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const { label, url } of PAGES) {
    console.log(`\n\n===================== ${label} =====================`);
    console.log("URL:", url);
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000); // let client-side rendering settle

      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log("Rendered body text length:", bodyText.length);

      for (const p of PHRASES) {
        const re = new RegExp(p, "ig");
        const matches = [...bodyText.matchAll(re)];
        if (matches.length) {
          console.log(`\nPhrase "${p}" found ${matches.length}x in rendered text. Context:`);
          let count = 0;
          for (const m of matches) {
            if (count >= 3) break;
            const idx = m.index;
            const start = Math.max(0, idx - 100);
            const end = Math.min(bodyText.length, idx + 100);
            console.log(`  ...${bodyText.slice(start, end).replace(/\s+/g, " ")}...`);
            count++;
          }
        }
      }

      // Try to grab the buy-box area specifically: look for common CTA button
      // text (Add to cart / Buy Now / Notify Me) and print its own text plus
      // its parent's text for context.
      const ctaInfo = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll("button, a")].filter((el) => {
          const t = (el.innerText || "").trim().toLowerCase();
          return (
            t.includes("add to cart") ||
            t.includes("buy now") ||
            t.includes("notify me") ||
            t.includes("sold out") ||
            t.includes("out of stock")
          );
        });
        return candidates.slice(0, 5).map((el) => ({
          tag: el.tagName,
          text: el.innerText.trim(),
          parentText: el.parentElement ? el.parentElement.innerText.trim().slice(0, 300) : null,
        }));
      });
      console.log("\nCTA button candidates found:", JSON.stringify(ctaInfo, null, 2));
    } catch (err) {
      console.log("ERROR loading page:", err.message);
    } finally {
      await context.close();
    }
  }
  await browser.close();
})();
