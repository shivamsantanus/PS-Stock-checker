// Follow-up scratch investigation - Part 3.
// Found from part 2: Zepto DOES have an "electronics-appliances" category
// (cid 966dc8a0-8f21-420e-a897-8dd70b4228f6) with subcats "mobile-accessories"
// and "electricals-accessories" (top-picks). Browse that category's full
// subcategory list and product grid, looking for any product card carrying a
// genuine "coming soon"/"launching soon" badge - since PS5 itself is not a
// useful test case (already released/was in stock), this looks for it on
// whatever electronics Zepto actually stocks.
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newPage(browser);
    await page.goto("https://www.zepto.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    await applyPincode(page, "560075");

    const url = "https://www.zepto.com/cn/electronics-appliances/mobile-accessories/cid/966dc8a0-8f21-420e-a897-8dd70b4228f6/scid/5a14eb17-b896-4a5c-b4ae-b3d7f4d61acd";
    console.log("Navigating to electronics-appliances category:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // List sibling subcategory tabs/links on this category page.
    const subcatLinks = await page.locator("a[href*='/cn/']").evaluateAll((els) =>
      Array.from(new Set(els.map((e) => ({ href: e.getAttribute("href"), text: (e.textContent || "").trim() }))
        .map((o) => JSON.stringify(o))))
    ).catch(() => []);
    console.log("\nSubcategory/other cn links on this page (", subcatLinks.length, "):");
    console.log(Array.from(new Set(subcatLinks)).slice(0, 60).join("\n"));

    // Dump product card texts on this category grid page - each card's full
    // text, looking for any that includes "coming soon"/"launching soon" as
    // opposed to plain "ADD"/price.
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.log("\nFull visible body text length:", bodyText.length);
    console.log("Contains 'coming soon':", bodyText.toLowerCase().includes("coming soon"));
    console.log("Contains 'launching soon':", bodyText.toLowerCase().includes("launching soon"));
    console.log("Contains 'notify':", bodyText.toLowerCase().includes("notify"));
    console.log("Contains 'out of stock':", bodyText.toLowerCase().includes("out of stock"));

    // Dump first ~2500 chars to see actual product names in this category (to
    // gauge whether Zepto even carries phones/consoles here, or just cables).
    console.log("\nFirst 2500 chars of body text:\n", bodyText.replace(/\s+/g, " ").slice(0, 2500));

    // Try clicking into a product card to see individual PDP structure - grab
    // hrefs of product links (pattern /pn/.../pvid/...).
    const productLinks = await page.locator("a[href*='/pn/']").evaluateAll((els) =>
      Array.from(new Set(els.map((e) => e.getAttribute("href"))))
    ).catch(() => []);
    console.log("\nProduct PDP links found on this category page (", productLinks.length, "):");
    console.log(productLinks.slice(0, 30).join("\n"));
  } finally {
    await browser.close();
  }
})();
