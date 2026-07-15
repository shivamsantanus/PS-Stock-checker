// Scratch investigation - Sony Center (shopatsc.com) "upcoming stock" signal.
// Goal: check live, right now, whether the Shopify /products/<handle>.js JSON
// or the rendered PDP HTML expose any "coming soon / pre-order / restock ETA"
// signal beyond the top-level `available` boolean already used in targets.ts.
const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PRODUCTS = [
  "playstation-5-standard-edition",
  "playstation-5-digital-edition",
];

async function fetchJs(handle) {
  const url = `https://shopatsc.com/products/${handle}.js`;
  console.log("\n=== JSON:", url, "===");
  try {
    const { data, status } = await axios.get(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: 20000,
    });
    console.log("HTTP status:", status);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.log("ERROR fetching JS:", err.message);
  }
}

async function fetchHtml(handle) {
  const url = `https://shopatsc.com/products/${handle}`;
  console.log("\n=== HTML:", url, "===");
  try {
    const { data, status } = await axios.get(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000,
    });
    console.log("HTTP status:", status, "length:", data.length);

    const phrases = [
      "coming soon",
      "notify me",
      "pre-order",
      "preorder",
      "pre order",
      "launching",
      "launch date",
      "sold out",
      "restock",
      "back in stock",
      "expected",
      "eta",
    ];
    for (const p of phrases) {
      const re = new RegExp(p, "ig");
      const matches = [...data.matchAll(re)];
      if (matches.length) {
        console.log(`\nPhrase "${p}" found ${matches.length}x. Context samples:`);
        // Print surrounding context for up to first 3 matches.
        let count = 0;
        for (const m of matches) {
          if (count >= 3) break;
          const idx = m.index;
          const start = Math.max(0, idx - 120);
          const end = Math.min(data.length, idx + 120);
          console.log(`  ...${data.slice(start, end).replace(/\s+/g, " ")}...`);
          count++;
        }
      } else {
        console.log(`Phrase "${p}" NOT found.`);
      }
    }

    // Also dump any <script type="application/ld+json"> or <script id="ProductJson-*">
    // which Shopify themes commonly use to embed full product/variant data.
    const scriptMatches = [...data.matchAll(/<script[^>]*id=["']([^"']*product[^"']*)["'][^>]*>([\s\S]*?)<\/script>/gi)];
    console.log(`\nFound ${scriptMatches.length} product-related inline <script id="..."> blocks.`);
    for (const m of scriptMatches.slice(0, 5)) {
      console.log(`--- script id="${m[1]}" (first 1500 chars) ---`);
      console.log(m[2].slice(0, 1500));
    }
  } catch (err) {
    console.log("ERROR fetching HTML:", err.message);
  }
}

(async () => {
  for (const handle of PRODUCTS) {
    await fetchJs(handle);
    await fetchHtml(handle);
  }
})();
