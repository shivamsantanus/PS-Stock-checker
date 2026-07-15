// Scratch investigation #9 - continuing deep8: deep8's DOM-badge search found
// nothing for "iphone 17"/"pre-order"/"coming soon"/"pre book" queries. This
// script tries a different approach: use Croma's own JSON search-service API
// (api.croma.com/searchservices/v1/search - same one used successfully in
// _croma_deep7.js with a cookie jar) across several broad category queries,
// and scan every returned product's raw JSON for ANY key/value that hints at
// a pre-order/coming-soon/notify-me stock status distinct from plain
// in-stock/out-of-stock (e.g. stock.stockLevelStatus enums, "PREORDER",
// "COMINGSOON", "NOTIFY", "LAUNCH", etc).
//
// If a candidate with a distinct status is found, call the OMS
// details-pwa API with its product code as itemID to compare against the
// PS5 SKUs' NOT_ENOUGH_PRODUCT_CHOICES.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const STATE_FILE = path.join(__dirname, "_croma_state2.json");
const OMS_URL = "https://api.croma.com/inventory/oms/v2/tms/details-pwa/";
const SUB_KEY = "1131858141634e2abe2efb2b3a2a2a5d";
const SEARCH_URL = "https://api.croma.com/searchservices/v1/search";

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
            shipToAddress: {
              company: "",
              country: "",
              city: "",
              mobilePhone: "",
              state: "",
              zipCode: pincode,
              extn: { irlAddressLine1: "", irlAddressLine2: "" },
            },
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
    const res = await axios.post(OMS_URL, promiseBody(itemId, pincode), {
      headers: baseHeaders,
      timeout: 15000,
      validateStatus: () => true,
    });
    console.log("HTTP status:", res.status);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}

// Recursively scan an object for keys/values that look stock-status-related.
function scanForStatusFields(obj, productCode, productName, hits, seenPaths, pathStr = "") {
  if (obj == null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const curPath = pathStr ? `${pathStr}.${k}` : k;
    if (typeof v === "string") {
      if (/stock|avail|preorder|pre_order|prebook|pre_book|comingsoon|coming_soon|notify|launch|backorder|eta|expected/i.test(k) ||
          /preorder|pre_order|prebook|pre_book|comingsoon|coming_soon|notify|backorder/i.test(v)) {
        const key = `${productCode}::${curPath}=${v}`;
        if (!seenPaths.has(key)) {
          seenPaths.add(key);
          hits.push({ productCode, productName, path: curPath, value: v });
        }
      }
    } else if (typeof v === "object") {
      scanForStatusFields(v, productCode, productName, hits, seenPaths, curPath);
    }
  }
}

(async () => {
  // ---- Phase A: headful, mint fresh cookies + look at homepage nav for an
  // "upcoming/new launches" section, and try the REAL search box. ----
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  console.log("########## PHASE A: homepage + real search box ##########");
  const home = await page.goto("https://www.croma.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
    console.log("homepage goto error:", e.message.split("\n")[0]);
    return null;
  });
  console.log("homepage status:", home && home.status());
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const navLinks = await page.locator("a").evaluateAll((as) =>
    as
      .map((a) => ({ text: (a.innerText || "").trim(), href: a.getAttribute("href") }))
      .filter((x) => x.text && /upcoming|new launch|launching|notify|pre-?order|pre-?book|coming soon/i.test(x.text))
  );
  console.log("Nav/body links mentioning upcoming/launch/pre-order:", JSON.stringify(navLinks).slice(0, 2000));

  // Try the real search box with a broad, currently-relevant query.
  for (const term of ["iphone 17", "upcoming"]) {
    try {
      const searchInput = page.locator("input[type='search'], input[id*='search' i], input[placeholder*='search' i]").first();
      if ((await searchInput.count()) > 0) {
        await searchInput.click();
        await searchInput.fill(term);
        await page.waitForTimeout(500);
        await searchInput.press("Enter");
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
        console.log(`\n[real search box] term="${term}" -> url now: ${page.url()}`);
        const bodyTextLen = await page.locator("body").innerText().then((t) => t.length).catch(() => -1);
        console.log("  body text length:", bodyTextLen);
        const badgeCount = await page.getByText(/coming soon|notify me|pre-?book|pre-?order/i).count();
        console.log("  badge matches:", badgeCount);
      } else {
        console.log(`[real search box] no search input found for term "${term}"`);
      }
    } catch (e) {
      console.log(`[real search box] error for "${term}":`, e.message.split("\n")[0]);
    }
  }

  await context.storageState({ path: STATE_FILE });
  await browser.close();

  // ---- Phase B: use the JSON search-service API directly with cookies,
  // across several broad category queries, scanning for status fields. ----
  console.log("\n\n########## PHASE B: JSON search-service scan ##########");
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const cookieHeader = state.cookies
    .filter((c) => c.domain.includes("croma.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const searchHeaders = { ...baseHeaders, Cookie: cookieHeader };

  const queries = [
    "iphone:relevance",
    "mobiles:relevance",
    "laptop:relevance",
    "television:relevance",
    "playstation:relevance",
    "upcoming:relevance",
    "new launch:relevance",
  ];

  const allHits = [];
  const seenPaths = new Set();
  const allStatusValues = new Set();

  for (const q of queries) {
    try {
      const res = await axios.get(SEARCH_URL, {
        params: { currentPage: 0, query: q, fields: "FULL", channel: "WEB", channelCode: "collection", pageSize: 40 },
        headers: searchHeaders,
        timeout: 15000,
        validateStatus: () => true,
      });
      const products = res.data?.products || res.data?.searchPageData?.results || [];
      console.log(`\n[search:"${q}"] status ${res.status}, products: ${products.length}`);
      for (const p of products) {
        const code = p.code;
        const name = p.name;
        // Collect every distinct stockLevelStatus-like value we see, even if
        // it doesn't match the "interesting" regex, so we know the full enum.
        (function collectStatus(o) {
          if (o == null || typeof o !== "object") return;
          for (const [k, v] of Object.entries(o)) {
            if (typeof v === "string" && /status/i.test(k)) allStatusValues.add(`${k}=${v}`);
            else if (typeof v === "object") collectStatus(v);
          }
        })(p);
        scanForStatusFields(p, code, name, allHits, seenPaths);
      }
      // Print first product's stock-related subtree as a shape sample.
      if (products[0]) {
        const first = products[0];
        console.log("  sample product code/name:", first.code, "|", first.name);
        if (first.stock) console.log("  sample .stock:", JSON.stringify(first.stock));
      }
    } catch (e) {
      console.log(`[search:"${q}"] ERROR:`, e.message);
    }
  }

  console.log("\nAll distinct *status fields seen across all products:", JSON.stringify([...allStatusValues], null, 2));
  console.log("\nInteresting hits (pre-order/coming-soon/notify/etc keyword matches):");
  console.log(JSON.stringify(allHits, null, 2));

  // ---- Phase C: if we found a candidate product code with a distinct
  // status, run it through the OMS API for comparison. ----
  const candidate = allHits.find((h) => h.productCode);
  if (candidate) {
    console.log(`\n\n########## PHASE C: OMS call for candidate ${candidate.productCode} (${candidate.productName}) ##########`);
    await callOms(candidate.productCode, "560075", `${candidate.productName} [${candidate.path}=${candidate.value}]`);
  } else {
    console.log("\nNo candidate product with an interesting status field found via this scan.");
  }

  console.log("\nDONE.");
})();
