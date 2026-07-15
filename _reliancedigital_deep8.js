// Scratch investigation #8 - deep7 found the REAL catalog product-detail
// endpoint is v1.0, not v2.0 (v2.0 404s; v1.0 returns 200 with a full body).
// It exposes tags / teaser_tag / promo_meta / product_group_tag - the exact
// badge/label-shaped fields the task asked to check for a "coming soon" /
// "pre-book" marker. Dump those fields specifically, full, for all 3 slugs.
const axios = require("axios");

const BEARER = "Bearer NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==";

const SLUGS = [
  "sony-playstation-ps5-slim-console-luh1rv-7537998",
  "sony-playstation-ps5-slim-digital-console-luh1rv-7537999",
  "sony-playstation-5-digital-edition-console",
];

async function fetchDetail(slug) {
  const url = `https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/${slug}/`;
  console.log("\n=== CATALOG v1.0 DETAIL ===", slug);
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
  if (res.status !== 200) {
    console.log(JSON.stringify(body).slice(0, 300));
    return;
  }
  console.log("tags:", JSON.stringify(body.tags));
  console.log("teaser_tag:", JSON.stringify(body.teaser_tag));
  console.log("promo_meta:", JSON.stringify(body.promo_meta));
  console.log("product_group_tag:", JSON.stringify(body.product_group_tag));
  console.log("custom_order:", JSON.stringify(body.custom_order));
  console.log("moq:", JSON.stringify(body.moq));
  console.log("item_type:", JSON.stringify(body.item_type));
  console.log("is_dependent:", JSON.stringify(body.is_dependent));
  console.log("_custom_json:", JSON.stringify(body._custom_json));
  console.log("_custom_meta:", JSON.stringify(body._custom_meta));

  // Full recursive sweep for anything upcoming/pre-order/coming-soon-ish,
  // in case such a marker lives inside a nested object we haven't printed.
  const hits = [];
  const interestingKeyRe = /tag|badge|label|pre.?order|preorder|coming.?soon|upcoming|launch|expected|restock|eta\b|notify|available.?from|dispatch/i;
  (function walk(node, path) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof node === "object") {
      for (const k of Object.keys(node)) {
        const p = path ? `${path}.${k}` : k;
        if (interestingKeyRe.test(k)) hits.push({ path: p, value: node[k] });
        walk(node[k], p);
      }
    }
  })(body, "");
  console.log("--- full recursive interesting-key sweep ---");
  console.log(hits.length ? JSON.stringify(hits, null, 2) : "(none found)");
}

(async () => {
  for (const slug of SLUGS) {
    await fetchDetail(slug);
  }
})();
