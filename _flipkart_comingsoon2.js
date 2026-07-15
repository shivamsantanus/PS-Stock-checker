// Follow-up scratch script:
// 1) Fix offers-array bug (parsed jsonLD is a top-level ARRAY, so it's
//    parsed[0].offers, not parsed.offers).
// 2) Find genuinely upcoming/"coming soon"/pre-order products on Flipkart
//    by grepping search-result HTML around the literal matches to recover
//    the product link nearest each match, then dump THEIR jsonLD.
const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function extractJsonLd(html) {
  const m = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*id=["']jsonLD["'][^>]*>([\s\S]*?)<\/script>/i
  );
  return m ? m[1] : null;
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
      console.log("NO jsonLD script found.");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.log("failed to parse jsonLD:", e.message);
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const offersList = Array.isArray(item.offers) ? item.offers : [item.offers];
      for (const o of offersList) {
        if (!o) continue;
        console.log("name:", item.name);
        console.log("offer fields:", {
          availability: o.availability,
          validFrom: o.validFrom,
          availabilityStarts: o.availabilityStarts,
          availabilityEnds: o.availabilityEnds,
          price: o.price,
        });
      }
    }
    console.log("\nFULL jsonLD:\n", JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.log("ERROR fetching:", err.message);
  }
}

async function findUpcomingCandidates(query) {
  const url = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
  console.log(`\n--- Searching: "${query}" ---`);
  const { data, status } = await axios.get(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 20000,
  });
  console.log("status:", status, "length:", data.length);

  const phrases = ["coming soon", "notify me", "pre-order", "preorder", "launching on"];
  const foundUrls = new Set();
  for (const p of phrases) {
    const re = new RegExp(p, "ig");
    let m;
    while ((m = re.exec(data))) {
      const idx = m.index;
      // Search backwards up to 4000 chars for the nearest product link,
      // since the badge usually sits inside the same product-tile <a>.
      const windowStart = Math.max(0, idx - 4000);
      const windowEnd = Math.min(data.length, idx + 500);
      const chunk = data.slice(windowStart, windowEnd);
      const linkMatches = [...chunk.matchAll(/href="(\/[a-z0-9\-]+\/p\/itm[a-z0-9]+)[^"]*"/gi)];
      if (linkMatches.length) {
        // nearest = last match found (closest to idx since we scanned up to idx)
        const nearest = linkMatches[linkMatches.length - 1][1];
        foundUrls.add(nearest);
        console.log(`  match "${p}" @${idx} -> nearest product link: ${nearest}`);
      } else {
        console.log(`  match "${p}" @${idx} -> no nearby product link found`);
      }
    }
  }
  return [...foundUrls];
}

(async () => {
  const candidates = new Set();
  for (const q of ["upcoming mobiles", "coming soon mobiles", "pre-order phone", "upcoming launch smartphone"]) {
    try {
      const found = await findUpcomingCandidates(q);
      found.forEach((f) => candidates.add(f));
    } catch (e) {
      console.log("search error:", e.message);
    }
  }
  console.log("\n\nCandidate upcoming-product URLs found:", [...candidates]);

  for (const path of [...candidates].slice(0, 5)) {
    await dumpJsonLd("Candidate: " + path, "https://www.flipkart.com" + path);
  }
})();
