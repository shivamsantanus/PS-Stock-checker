// Scratch investigation #15 - deep14 found the OMS response schema has an
// extn.preOrderItem field inside each successful promiseLine assignment
// (currently "" empty for every Fold7/Flip7/PS5/etc item checked so far).
// This is a final quick pass: check a couple more plausible "just
// announced, pre-booking open" categories (wearables/smartwatches, tablets)
// plus the homepage hero banner carousel, to see if ANY live product
// currently has preOrderItem populated (non-empty) or a productAvailDate
// far in the future - which would be the ground-truth confirmation of the
// pre-order signal.
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
  try {
    const res = await axios.post(OMS_URL, promiseBody(itemId, pincode), { headers: baseHeaders, timeout: 15000, validateStatus: () => true });
    const line = res.data?.promise?.suggestedOption?.option?.promiseLines?.promiseLine?.[0];
    const unavail = res.data?.promise?.suggestedOption?.unavailableLines?.unavailableLine?.[0];
    const preOrder = line?.extn?.preOrderItem;
    const availDate = line?.assignments?.assignment?.[0]?.productAvailDate;
    const deliveryDate = line?.assignments?.assignment?.[0]?.deliveryDate;
    console.log(
      `  [${label}] item=${itemId} status=${res.status} unavailableReason=${unavail?.unavailableReason || "-"} preOrderItem="${preOrder ?? "N/A"}" productAvailDate=${availDate || "-"} deliveryDate=${deliveryDate || "-"}`
    );
  } catch (e) {
    console.log(`  [${label}] item=${itemId} ERROR:`, e.message);
  }
}

async function loadWithRetry(page, url, minLen = 3000, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("  goto err:", e.message.split("\n")[0]));
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    for (let s = 0; s < 8; s++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    const text = await page.locator("body").innerText().catch(() => "");
    if (text.length >= minLen) return text;
    await page.waitForTimeout(1500);
  }
  return await page.locator("body").innerText().catch(() => "");
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  const categories = [
    ["smartwatches", "https://www.croma.com/phones-wearables/wearables/smart-watches/c/197"],
    ["tablets", "https://www.croma.com/computers-tablets/tablets/c/13"],
  ];

  for (const [label, url] of categories) {
    console.log(`\n########## ${label}: ${url} ##########`);
    const text = await loadWithRetry(page, url);
    console.log("  body text length:", text.length);
    const kw = /(coming soon|notify me|pre-?book|pre-?order|launching soon|available soon)/gi;
    const matches = [...text.matchAll(kw)].map((m) => m[0]);
    console.log("  keyword matches:", JSON.stringify(matches));
    const hrefs = await page.locator("a[href*='/p/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]).catch(() => []);
    console.log(`  ${hrefs.length} product hrefs found, checking OMS for first 6:`);
    const ids = hrefs
      .map((h) => {
        const m = h.match(/\/p\/(\d+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean)
      .slice(0, 6);
    for (const id of ids) {
      await callOms(id, "560075", label);
    }
  }

  await browser.close();
  console.log("\nDONE.");
})();
