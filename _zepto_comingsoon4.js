// Follow-up scratch investigation - Part 4.
// Check Zepto's "Mobile Phones" and "Gaming" subcategories (found under
// Electronics & Appliances in part 3) for any product actually marked
// coming-soon/launching-soon/pre-order, and dump full product name list.
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

async function inspectCategory(page, url, label) {
  console.log(`\n\n=== ${label} ===`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Scroll a bit to trigger lazy-loaded product cards.
  await page.mouse.wheel(0, 3000).catch(() => {});
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 3000).catch(() => {});
  await page.waitForTimeout(1500);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log("Body text length:", bodyText.length);
  for (const phrase of ["coming soon", "launching soon", "pre-order", "preorder", "notify", "out of stock", "sold out"]) {
    const has = bodyText.toLowerCase().includes(phrase);
    console.log(`  contains "${phrase}":`, has);
    if (has) {
      const idx = bodyText.toLowerCase().indexOf(phrase);
      console.log(`    -> ...${bodyText.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, " ")}...`);
    }
  }
  console.log("\nFirst 3000 chars:\n", bodyText.replace(/\s+/g, " ").slice(0, 3000));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newPage(browser);
    await page.goto("https://www.zepto.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    await applyPincode(page, "560075");

    await inspectCategory(
      page,
      "https://www.zepto.com/cn/electronics-appliances/mobile-phones/cid/966dc8a0-8f21-420e-a897-8dd70b4228f6/scid/b5ca40fc-b916-4b40-93c3-273991113745",
      "Mobile Phones category"
    );
    await inspectCategory(
      page,
      "https://www.zepto.com/cn/electronics-appliances/gaming/cid/966dc8a0-8f21-420e-a897-8dd70b4228f6/scid/fc8c5a74-340c-472f-a34b-a39b6caf5ede",
      "Gaming category"
    );
  } finally {
    await browser.close();
  }
})();
