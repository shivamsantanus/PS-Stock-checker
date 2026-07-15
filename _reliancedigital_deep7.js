// Scratch investigation #7 - the plain catalog/v2.0/products/<slug>/ URL
// 404'd in deep6. Probe a handful of plausible Fynd-platform product-detail
// endpoint variants live to find the real one (if any) that carries
// tags/badges/labels, before concluding none exists.
const axios = require("axios");

const BEARER = "Bearer NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==";
const SLUG = "sony-playstation-ps5-slim-console-luh1rv-7537998";

const CANDIDATES = [
  `https://www.reliancedigital.in/api/service/application/catalog/v2.0/products/${SLUG}`, // no trailing slash
  `https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/${SLUG}/`,
  `https://www.reliancedigital.in/api/service/application/content/v2.0/products/${SLUG}/`,
  `https://www.reliancedigital.in/api/service/application/catalog/v2.0/products/${SLUG}/sizes/`,
  `https://www.reliancedigital.in/api/service/application/catalog/v2.0/product/${SLUG}/`,
  `https://www.reliancedigital.in/api/service/application/catalog/v2.0/products/${SLUG}/variants/`,
];

async function probe(url) {
  console.log("\nGET", url);
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
    if (res.status === 200) {
      const body = res.data;
      console.log("Top-level keys:", body && typeof body === "object" ? Object.keys(body) : typeof body);
      console.log(JSON.stringify(body, null, 2).slice(0, 6000));
    } else {
      console.log(JSON.stringify(res.data).slice(0, 300));
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  }
}

(async () => {
  for (const url of CANDIDATES) {
    await probe(url);
  }
})();
