// Scratch investigation #14 - deep13 found a dedicated "Flip and Fold Mobile
// Phones" category page (croma.com/phones-wearables/mobile-phones/flip-and-fold-mobile-phones/c/199).
// Foldables are the most plausible genuine pre-order/coming-soon category
// (Samsung/others often open pre-booking before launch). Visit it directly,
// list every product tile + PDP url, and scan for pre-order/coming-soon/
// notify-me wording. If a plausible newly-launched foldable is found (not an
// old Z Flip5/Pixel Fold from the SEO blurb), grab its itemID from the PDP
// and call the OMS API to compare its unavailableReason against the PS5 SKUs.
const { chromium } = require("playwright");
const axios = require("axios");

const OMS_URL = "https://api.croma.com/inventory/oms/v2/tms/details-pwa/";
const SUB_KEY = "1131858141634e2abe2efb2b3a2a2a5d";
const baseHeaders = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "oms-apim-subscription-key": SUB_KEY,
  Referer: "https://www.croma.com/",
  Origin: "https://www.croma.com",
};
function promiseBody(itemId, pincode) {
  return {
    promise: {
      allocationRuleID: "SYSTEM",
      checkInventory: "Y",
      organizationCode: "CROMA",
      sourcingClassification: "EC",
      promiseLines: {
        promiseLine: [
          {
            fulfillmentType: "HDEL",
            mch: "",
            itemID: itemId,
            lineId: "1",
            categoryType: "nonMobile",
            reqEndDate: "2500-01-01",
            reqStartDate: "",
            requiredQty: "1",
            shipToAddress: { company: "", country: "", city: "", mobilePhone: "", state: "", zipCode: pincode, extn: { irlAddressLine1: "", irlAddressLine2: "" } },
            extn: { widerStoreFlag: "N" },
          },
        ],
      },
    },
  };
}
async function callOms(itemId, pincode, label) {
  console.log(`\n===== OMS call: ${label || itemId} (item ${itemId}) =====`);
  try {
    const res = await axios.post(OMS_URL, promiseBody(itemId, pincode), { headers: baseHeaders, timeout: 15000, validateStatus: () => true });
    console.log("HTTP status:", res.status);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}

async function loadWithRetry(page, url, minLen = 5000, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    console.log(`attempt ${i}: goto ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("  goto err:", e.message.split("\n")[0]));
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    for (let s = 0; s < 8; s++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    const text = await page.locator("body").innerText().catch(() => "");
    console.log(`  body text length: ${text.length}`);
    if (text.length >= minLen) return text;
    await page.waitForTimeout(1500);
  }
  return await page.locator("body").innerText().catch(() => "");
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  const url = "https://www.croma.com/phones-wearables/mobile-phones/flip-and-fold-mobile-phones/c/199";
  const fullText = await loadWithRetry(page, url);

  console.log("\nFull text snippet (first 3000 chars):\n", fullText.slice(0, 3000));

  const kw = /(coming soon|notify me|pre-?book|pre-?order|launching soon|available soon|out of stock|sold out)/gi;
  const matches = [...fullText.matchAll(kw)].map((m) => m[0]);
  console.log("\nkeyword matches:", JSON.stringify(matches));

  const productHrefs = await page.locator("a[href*='/p/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  console.log("\nProduct PDP hrefs on this category page:", productHrefs.length);
  for (const h of productHrefs) console.log("  -", h);

  await browser.close();

  // For each product found, extract itemID from URL and call OMS to see
  // stock/unavailableReason - if any differs from NOT_ENOUGH_PRODUCT_CHOICES
  // that's the signal we're after. Cap at 8 to keep this reasonable.
  const ids = productHrefs
    .map((h) => {
      const m = h.match(/\/p\/(\d+)/);
      return m ? { id: m[1], href: h } : null;
    })
    .filter(Boolean)
    .slice(0, 8);

  console.log("\n\n########## OMS calls for each foldable phone found ##########");
  for (const { id, href } of ids) {
    await callOms(id, "560075", href);
  }

  console.log("\nDONE.");
})();
