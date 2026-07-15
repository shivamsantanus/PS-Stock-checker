// Follow-up scratch investigation - Part 2 continued.
// The first pass (_zepto_comingsoon.js) found that searching Zepto's own
// search bar for the literal strings "coming soon" / "launching soon" just
// echoes the query back in a generic "Showing results for ..." header and
// returns unrelated grocery products - no product CARD actually carries a
// "coming soon" badge for those queries. This script tries more
// Zepto-catalog-appropriate terms (electronics/gadgets Zepto actually stocks,
// new FMCG launches, etc.) and also inspects product-card DOM structure for
// any badge/tag element that might carry "coming soon"-ish text distinct from
// plain search-header echo.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function newPage(browser) {
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-IN",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" },
  });
  return context.newPage();
}

async function applyPincode(page, pincode) {
  try {
    await page.click("[data-testid='user-address']", { timeout: 15000 });
    await page.fill("[data-testid='address-search-input'] input", pincode, { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.click("[data-testid='address-search-item']", { timeout: 15000 });
    await page.waitForTimeout(7000);
    return true;
  } catch (err) {
    console.log("  Pincode apply FAILED:", err.message);
    return false;
  }
}

async function searchAndInspect(page, query) {
  console.log(`\n--- Query: "${query}" ---`);
  await page.goto(`https://www.zepto.com/search?query=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForTimeout(3000);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const header = bodyText.match(/Showing results for[^\n]*|Could not find any products[^\n]*/);
  console.log("  Result header:", header ? header[0] : "(none matched)");

  // Count product cards via a stable-ish data-testid if present.
  const testIds = await page.locator("[data-testid]").evaluateAll((els) =>
    Array.from(new Set(els.map((e) => e.getAttribute("data-testid"))))
  ).catch(() => []);
  const productCardIds = testIds.filter((t) => t && /product|card/i.test(t));
  console.log("  product/card-ish data-testids present:", productCardIds.join(", ") || "(none)");

  // Look for any badge-ish overlay text on cards: common patterns are short
  // all-caps or title-case strings distinct from price/ADD button.
  const badgeTexts = await page.evaluate(() => {
    const out = new Set();
    const all = document.querySelectorAll("[class*='tag' i], [class*='badge' i], [class*='label' i]");
    all.forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t && t.length < 40) out.add(t);
    });
    return Array.from(out);
  }).catch(() => []);
  console.log("  tag/badge/label-class element texts found:", badgeTexts.length ? JSON.stringify(badgeTexts.slice(0, 40)) : "(none)");

  for (const phrase of ["coming soon", "launching soon", "notify", "out of stock", "sold out", "unavailable", "pre-order", "preorder"]) {
    if (bodyText.toLowerCase().includes(phrase)) {
      const idx = bodyText.toLowerCase().indexOf(phrase);
      console.log(`    phrase "${phrase}" found -> ...${bodyText.slice(Math.max(0,idx-50), idx+80).replace(/\s+/g," ")}...`);
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newPage(browser);
    await page.goto("https://www.zepto.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    await applyPincode(page, "560075");

    const queries = [
      "iphone 17",
      "iphone",
      "samsung galaxy",
      "playstation 5 pro",
      "new launch",
      "limited edition",
      "electronics",
      "mobile phones",
      "smart watch",
      "gaming console",
    ];
    for (const q of queries) {
      try {
        await searchAndInspect(page, q);
      } catch (err) {
        console.log(`  ERROR searching "${q}":`, err.message);
      }
    }

    // Also try browsing the homepage category grid for anything electronics-like.
    console.log("\n--- Homepage category links ---");
    await page.goto("https://www.zepto.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const catLinks = await page.locator("a[href]").evaluateAll((els) =>
      Array.from(new Set(els.map((e) => e.getAttribute("href")).filter((h) => h && /category|cn\//.test(h))))
    ).catch(() => []);
    console.log("category-ish links found:", catLinks.length);
    console.log(catLinks.slice(0, 60).join("\n"));
  } finally {
    await browser.close();
  }
})();
