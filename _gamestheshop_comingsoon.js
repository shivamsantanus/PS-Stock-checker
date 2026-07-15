// Scratch investigation - Games The Shop "upcoming/coming-soon" signal hunt.
// The wired target only reads data.stock_status + data.total_inventory.
// Dump the FULL data object for both PS5 Slim SKUs to look for any
// pre-order / restock-ETA / upcoming field the current parsing ignores.
const axios = require("axios");

const PRODUCTS = {
  "PS5 Slim Disc": "1fe01712-6e2b-49b0-9f93-f9670b4ec2a8",
  "PS5 Slim Digital": "0a3c6810-ed3d-4bec-8e98-48a2ed5208fd",
};

async function fetchProduct(id) {
  const url = `https://green-api.gamestheshop.com/storefront/products/${id}`;
  const res = await axios.get(url, { headers: { Accept: "application/json" } });
  return res.data;
}

(async () => {
  for (const [label, id] of Object.entries(PRODUCTS)) {
    console.log(`\n================ ${label} (${id}) ================`);
    try {
      const body = await fetchProduct(id);
      console.log("Top-level keys:", Object.keys(body));
      console.log("Full data object:\n", JSON.stringify(body.data, null, 2));
    } catch (e) {
      console.log("ERROR:", e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message);
    }
  }
})();
