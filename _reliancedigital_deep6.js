// Scratch investigation #6 - re-verify LIVE, right now (2026-07-15), whether
// the per-pincode sizes/price endpoint's tat/distance/delivery_promise fields
// are still null (as documented in the relianceDigitalTarget comment in
// src/targets.ts), or have been populated since, and whether ANY other
// "upcoming/pre-order/coming-soon" style field exists anywhere - either in
// this per-pincode endpoint or in the plain catalog product-detail endpoint
// (tags/badges/labels arrays).
const axios = require("axios");

const BEARER = "Bearer NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==";

const SLUGS = [
  "sony-playstation-ps5-slim-console-luh1rv-7537998", // disc
  "sony-playstation-ps5-slim-digital-console-luh1rv-7537999", // digital
  "sony-playstation-5-digital-edition-console", // digital edition
];

const PINCODES = ["560075", "147002"]; // Bangalore, Patiala

async function hitSizesPrice(slug, pincode) {
  const url = `https://www.reliancedigital.in/api/service/application/catalog/v2.0/products/${slug}/sizes/OS/price/?pincode=${pincode}`;
  console.log("\n=== SIZES/PRICE ===", slug, "| pincode", pincode);
  console.log("GET", url);
  try {
    const res = await axios.get(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        authorization: BEARER,
        "x-currency-code": "INR",
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    console.log("HTTP", res.status);
    console.log(JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (err) {
    console.log("ERROR:", err.message);
    return null;
  }
}

async function hitCatalogDetail(slug) {
  const url = `https://www.reliancedigital.in/api/service/application/catalog/v2.0/products/${slug}/`;
  console.log("\n=== CATALOG DETAIL ===", slug);
  console.log("GET", url);
  try {
    const res = await axios.get(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        authorization: BEARER,
        "x-currency-code": "INR",
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    console.log("HTTP", res.status);
    const body = res.data;
    console.log("Top-level keys:", body && typeof body === "object" ? Object.keys(body) : typeof body);
    console.log(JSON.stringify(body, null, 2));

    // Specifically hunt for tag/badge/label-shaped fields and any
    // upcoming/pre-order/coming-soon-ish keys anywhere in the tree.
    const hits = [];
    const interestingKeyRe = /tag|badge|label|pre.?order|preorder|coming.?soon|upcoming|launch|expected|restock|eta|notify/i;
    (function walk(node, path) {
      if (node === null || node === undefined) return;
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (typeof node === "object") {
        for (const k of Object.keys(node)) {
          const p = path ? `${path}.${k}` : k;
          if (interestingKeyRe.test(k)) {
            hits.push({ path: p, value: node[k] });
          }
          walk(node[k], p);
        }
      }
    })(body, "");
    console.log("\n--- Interesting key matches (tag/badge/label/pre-order/coming-soon/upcoming/launch/expected/restock/eta/notify) ---");
    console.log(hits.length ? JSON.stringify(hits, null, 2) : "(none found)");
    return body;
  } catch (err) {
    console.log("ERROR:", err.message);
    return null;
  }
}

(async () => {
  console.log("############ PER-PINCODE SIZES/PRICE ENDPOINT ############");
  for (const slug of SLUGS) {
    for (const pincode of PINCODES) {
      const data = await hitSizesPrice(slug, pincode);
      if (data && typeof data === "object") {
        console.log(
          "  -> tat:", data.tat,
          "| distance:", data.distance,
          "| delivery_promise:", JSON.stringify(data.delivery_promise),
          "| article_id:", data.article_id,
          "| quantity:", data.quantity,
          "| store:", JSON.stringify(data.store)
        );
        // Full key sweep for anything not already known.
        const knownKeys = new Set([
          "article_id", "quantity", "price", "store", "tat", "distance",
          "delivery_promise", "seller", "set", "price_per_piece", "special_badge",
          "article_assignment", "return_config", "discount", "marketplace_seller_id",
        ]);
        const extraKeys = Object.keys(data).filter((k) => !knownKeys.has(k));
        if (extraKeys.length) {
          console.log("  -> OTHER top-level keys not in known set:", extraKeys.join(", "));
        }
      }
    }
  }

  console.log("\n\n############ CATALOG PRODUCT-DETAIL ENDPOINT (no pincode) ############");
  for (const slug of SLUGS) {
    await hitCatalogDetail(slug);
  }
})();
