// Scratch investigation - Flipkart "upcoming stock" signal.
// Goal: check live, right now, whether Flipkart's PS5 console PDP exposes
// any "coming soon / pre-order / restock ETA" signal beyond the
// `offers.availability` InStock/OutOfStock value already used in targets.ts.
//
// Part 1: fetch the jsonLD block live via plain axios (server-rendered,
// no JS needed) and dump the FULL block - not just availability - looking
// for validFrom/availabilityStarts and any non-InStock/OutOfStock enum
// value (PreOrder, PreSale, SoldOut, Discontinued, BackOrder, InStoreOnly,
// LimitedAvailability).
//
// Part 2: as a sanity check, do the same for a real, currently-not-yet-
// launched product on flipkart.com (found via search) to see what
// Flipkart's template actually uses for genuine "upcoming" listings.
const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PS5_URL =
  "https://www.flipkart.com/sony-playstation5-console-slim-cfi-2008a01x-1024-gb/p/itm89489e2adcd2c";

function extractJsonLd(html) {
  const m = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*id=["']jsonLD["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (m) return m[1];
  // fallback: any ld+json script
  const m2 = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return m2.map((x) => x[1]);
}

async function dumpJsonLd(label, url) {
  console.log(`\n\n===================== ${label} =====================`);
  console.log("URL:", url);
  try {
    const { data, status } = await axios.get(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000,
    });
    console.log("HTTP status:", status, "HTML length:", data.length);

    const raw = extractJsonLd(data);
    if (!raw) {
      console.log("NO jsonLD script found at all.");
      return null;
    }
    if (Array.isArray(raw)) {
      console.log(`Found ${raw.length} ld+json scripts (no id="jsonLD" match) - dumping all:`);
      for (const r of raw) {
        try {
          console.log(JSON.stringify(JSON.parse(r), null, 2));
        } catch (e) {
          console.log("(unparsable) raw:", r.slice(0, 2000));
        }
      }
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.log("jsonLD found but failed to parse:", e.message);
      console.log("raw (first 3000 chars):", raw.slice(0, 3000));
      return null;
    }
    console.log("\n--- FULL jsonLD (parsed) ---");
    console.log(JSON.stringify(parsed, null, 2));

    // Highlight fields of interest.
    const offers = Array.isArray(parsed.offers) ? parsed.offers : [parsed.offers];
    console.log("\n--- Fields of interest across offers[] ---");
    for (const o of offers) {
      if (!o) continue;
      console.log({
        availability: o.availability,
        validFrom: o.validFrom,
        availabilityStarts: o.availabilityStarts,
        availabilityEnds: o.availabilityEnds,
        price: o.price,
        priceValidUntil: o.priceValidUntil,
        itemCondition: o.itemCondition,
        seller: o.seller && o.seller.name,
      });
    }
    return parsed;
  } catch (err) {
    console.log("ERROR fetching:", err.message);
    return null;
  }
}

async function searchForUpcomingProduct() {
  // Search Flipkart for a phrase that tends to surface not-yet-launched
  // products with "coming soon" / pre-order badges, then try to pull a
  // product URL out of the search results HTML.
  const queries = ["upcoming mobiles", "coming soon mobiles", "pre-order phone"];
  for (const q of queries) {
    const url = `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`;
    console.log(`\n\n--- Searching: "${q}" -> ${url} ---`);
    try {
      const { data, status } = await axios.get(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 20000,
      });
      console.log("status:", status, "length:", data.length);
      // Product links look like /<slug>/p/<itmid>
      const linkMatches = [...data.matchAll(/href="(\/[a-z0-9\-]+\/p\/itm[a-z0-9]+)[^"]*"/gi)];
      const uniq = [...new Set(linkMatches.map((m) => m[1]))];
      console.log(`Found ${uniq.length} unique product links. First 10:`);
      uniq.slice(0, 10).forEach((u) => console.log("  https://www.flipkart.com" + u));
      // Also grep for "coming soon" / "notify me" text directly in search results.
      for (const phrase of ["coming soon", "notify me", "pre-order", "preorder", "launching on", "will be live"]) {
        const re = new RegExp(phrase, "ig");
        const count = (data.match(re) || []).length;
        if (count) console.log(`  phrase "${phrase}" appears ${count}x in search results HTML`);
      }
      if (uniq.length) return uniq[0];
    } catch (err) {
      console.log("ERROR searching:", err.message);
    }
  }
  return null;
}

(async () => {
  // Part 1: the actual PS5 target.
  await dumpJsonLd("PS5 console (current target)", PS5_URL);

  // Part 3: sanity check against a real upcoming/pre-order listing.
  const foundPath = await searchForUpcomingProduct();
  if (foundPath) {
    const url = "https://www.flipkart.com" + foundPath;
    await dumpJsonLd("Sanity-check upcoming product (from search)", url);
  } else {
    console.log("\nNo candidate upcoming-product URL found via search scraping.");
  }
})();
