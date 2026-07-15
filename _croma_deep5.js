// Scratch investigation #5 - Croma: with the minted cookie jar, hit the
// api.croma.com endpoints the PDP itself uses and inspect what stock signal
// they return. Also re-check the PDP HTML body via axios for any embedded
// availability JSON (React PWA shells sometimes still server-render some).
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const STATE_FILE = path.join(__dirname, "_croma_state.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const cookieHeader = state.cookies
  .filter((c) => c.domain.includes("croma.com"))
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");

const H = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: cookieHeader,
  Referer: "https://www.croma.com/",
  Origin: "https://www.croma.com",
};

(async () => {
  const gets = [
    "https://api.croma.com/pricing-services/v2/price/national?itemIds=321320&pincode=560075",
    "https://api.croma.com/product/allchannels/v1/pdp/deliveryoption/?productCode=321320&fields=DEFAULT",
    "https://api.croma.com/sku/v1/essentialcombo?pinCode=560075&ProductSkus=321320",
  ];
  for (const url of gets) {
    try {
      const res = await axios.get(url, { headers: H, timeout: 15000, validateStatus: () => true });
      console.log("=== GET", url.slice(22, 110), "-> status", res.status);
      console.log(JSON.stringify(res.data).slice(0, 1200));
      console.log();
    } catch (e) {
      console.log("=== GET", url.slice(22, 110), "ERROR", e.message);
    }
  }

  // The tms/details-pwa endpoint is likely a POST - try common payload shape.
  try {
    const res = await axios.post(
      "https://api.croma.com/inventory/oms/v2/tms/details-pwa/",
      { promise: { pincode: "560075", allocationRule: "STANDARD", skus: [{ skuId: "321320", quantity: 1 }] } },
      { headers: { ...H, "Content-Type": "application/json" }, timeout: 15000, validateStatus: () => true }
    );
    console.log("=== POST tms/details-pwa -> status", res.status);
    console.log(JSON.stringify(res.data).slice(0, 1200));
  } catch (e) {
    console.log("=== POST tms/details-pwa ERROR", e.message);
  }
})();
