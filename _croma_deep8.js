// Scratch investigation #8 - "upcoming stock" signal check for Croma's OMS
// delivery-promise API.
//
// Phase 1: call the OMS API live for the 3 known PS5 itemIDs and dump the
// FULL raw response body, looking for anything beyond unavailableReason
// (expectedDate, preBookEligible, extn fields, etc).
//
// Phase 2: headful real-Chrome search on croma.com for a genuine pre-order /
// "notify me" product (something unreleased), grab its itemID from the PDP
// URL, then call the SAME OMS API with that itemID to see whether its
// unavailableReason (or any other field) differs from NOT_ENOUGH_PRODUCT_CHOICES.
const axios = require("axios");
const { chromium } = require("playwright");

const OMS_URL = "https://api.croma.com/inventory/oms/v2/tms/details-pwa/";
const SUB_KEY = "1131858141634e2abe2efb2b3a2a2a5d";
const PINCODE = "560075";

const PS5_ITEMS = [
  { id: "321320", label: "PS5 Slim 1TB Standard Disc" },
  { id: "316841", label: "PS5 Slim 1TB Digital Edition" },
  { id: "305985", label: "PS5 Slim 1TB (original listing)" },
];

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
  console.log(`\n===== OMS call: ${label || itemId} (item ${itemId}, pincode ${pincode}) =====`);
  try {
    const res = await axios.post(OMS_URL, promiseBody(itemId, pincode), {
      headers: baseHeaders,
      timeout: 15000,
      validateStatus: () => true,
    });
    console.log("HTTP status:", res.status);
    console.log("FULL RAW BODY:\n", JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (e) {
    console.log("ERROR:", e.message);
    return null;
  }
}

(async () => {
  console.log("########## PHASE 1: known PS5 SKUs ##########");
  for (const item of PS5_ITEMS) {
    await callOms(item.id, PINCODE, item.label);
  }

  console.log("\n\n########## PHASE 2: hunt for a genuine pre-order product ##########");
  let candidateUrl = null;
  let candidateItemId = null;

  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  try {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    // Try a few likely "unreleased / pre-order" search terms on Croma's own
    // search UI. Croma frequently pre-lists not-yet-launched phones.
    const searchTerms = ["iphone 17", "pre-order", "coming soon", "pre book"];
    for (const term of searchTerms) {
      if (candidateUrl) break;
      const searchUrl = `https://www.croma.com/searchB?text=${encodeURIComponent(term)}`;
      console.log(`\n--- searching: "${term}" -> ${searchUrl}`);
      try {
        const resp = await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        console.log("search page status:", resp && resp.status());
        await page.waitForTimeout(3000);

        // Look for "coming soon" / "notify me" / "pre-book" badges on the
        // search results grid.
        const badgeLocator = page.getByText(/coming soon|notify me|pre-?book|pre-?order/i);
        const badgeCount = await badgeLocator.count();
        console.log(`  badge matches ("coming soon"/"notify me"/"pre-book"): ${badgeCount}`);

        if (badgeCount > 0) {
          // Walk up to the nearest product tile anchor and grab its href.
          for (let i = 0; i < Math.min(badgeCount, 5); i++) {
            const el = badgeLocator.nth(i);
            const txt = await el.innerText().catch(() => "");
            const href = await el
              .locator("xpath=ancestor::a[1]")
              .getAttribute("href")
              .catch(() => null);
            console.log(`   [${i}] text="${txt.trim().slice(0, 40)}" href=${href}`);
            if (href && /\/p\/\d+/.test(href)) {
              candidateUrl = href.startsWith("http") ? href : `https://www.croma.com${href}`;
              break;
            }
          }
        }
      } catch (e) {
        console.log("  search error:", e.message.split("\n")[0]);
      }
    }

    if (candidateUrl) {
      const m = candidateUrl.match(/\/p\/(\d+)/);
      candidateItemId = m ? m[1] : null;
      console.log(`\nCandidate pre-order product URL: ${candidateUrl}`);
      console.log(`Candidate itemID: ${candidateItemId}`);

      // Visit the PDP itself headful to confirm the badge / disabled CTA and
      // to sniff the real OMS request it fires (ground-truth itemID + body).
      let sniffedBody = null;
      page.removeAllListeners("request");
      page.on("request", (req) => {
        if (req.url() === OMS_URL && !sniffedBody) {
          sniffedBody = req.postData();
        }
      });
      const pdpResp = await page.goto(candidateUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
        console.log("PDP goto error:", e.message.split("\n")[0]);
        return null;
      });
      console.log("PDP status:", pdpResp && pdpResp.status());
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const ctas = await page.getByText(/add to cart|notify me|out of stock|sold out|buy now|coming soon|pre-?book|pre-?order/i).all();
      console.log("PDP CTA/badge matches:", ctas.length);
      for (const el of ctas.slice(0, 10)) {
        const info = await el
          .evaluate((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 90), txt: (e.innerText || "").trim().slice(0, 60) }))
          .catch(() => null);
        if (info) console.log("   -", JSON.stringify(info));
      }

      if (sniffedBody) {
        console.log("\nSniffed real OMS request body from PDP:\n", sniffedBody);
        try {
          const parsed = JSON.parse(sniffedBody);
          const lines = parsed?.promise?.promiseLines?.promiseLine || [];
          const sniffedItemId = lines[0]?.itemID;
          if (sniffedItemId && sniffedItemId !== candidateItemId) {
            console.log(`NOTE: sniffed itemID (${sniffedItemId}) differs from URL-derived itemID (${candidateItemId}) - using sniffed one.`);
            candidateItemId = sniffedItemId;
          }
        } catch (e) {
          console.log("could not parse sniffed body:", e.message);
        }
      } else {
        console.log("No OMS request sniffed from this PDP (maybe no stock check fires without a pincode).");
      }
    } else {
      console.log("\nNo pre-order/coming-soon candidate found via search terms tried.");
    }
  } finally {
    await browser.close();
  }

  if (candidateItemId) {
    console.log("\n\n########## PHASE 3: OMS call for the pre-order candidate ##########");
    await callOms(candidateItemId, PINCODE, "PRE-ORDER CANDIDATE");
  } else {
    console.log("\nSkipping phase 3 - no candidate itemID found.");
  }

  console.log("\nDONE.");
})();
