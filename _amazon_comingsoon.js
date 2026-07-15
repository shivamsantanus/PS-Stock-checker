// Scratch investigation - Amazon.in "upcoming stock" / pre-order signal.
// Goal: check live, right now, whether Amazon.in's PDP template exposes any
// "coming soon / pre-order / restock ETA" signal distinct from the plain
// "Currently unavailable" text already read from `#availability` in
// targets.ts. Loads the PS5 listing itself, dumps #availability/#buybox/
// buy-box container text, and greps the whole visible page text for
// pre-order-ish phrases. Also (separately) spot-checks a genuinely
// unreleased/pre-order product on amazon.in to see what template Amazon
// uses for that state, since the PS5 (already released, in-market) is
// unlikely to ever hit it itself.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PHRASES = [
  "coming soon",
  "pre-order",
  "preorder",
  "pre order",
  "this item will be released on",
  "notify me when available",
  "available on",
  "release date",
  "launching",
  "back in stock",
  "temporarily out of stock",
  "we don't know when",
  "expected",
];

async function newPage(browser) {
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-IN",
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en;q=0.9",
    },
  });
  return context.newPage();
}

async function dumpBuybox(page, label) {
  console.log(`\n--- ${label}: buy-box-ish selectors ---`);
  const candidates = [
    "#availability",
    "#buybox",
    "#contentGrid",
    "#dp-container",
    "#corePriceDisplay_desktop_feature_div",
    "#desktop_buybox",
    "#buybox-see-all-buying-choices",
    "#outOfStock",
    "#deliveryBlockMessage",
    "#dealBadge_feature_div",
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    const count = await page.locator(sel).count();
    if (!count) {
      console.log(`  ${sel}: (not present, 0 matches)`);
      continue;
    }
    const text = await loc.innerText().catch((e) => `<error: ${e.message}>`);
    console.log(`  ${sel} (${count} match(es)): ${JSON.stringify(text.slice(0, 400))}`);
  }
}

async function grepPhrases(page, label) {
  console.log(`\n--- ${label}: phrase search over visible body text ---`);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();
  for (const p of PHRASES) {
    const idx = lower.indexOf(p);
    if (idx === -1) {
      console.log(`  "${p}": NOT found`);
    } else {
      const start = Math.max(0, idx - 80);
      const end = Math.min(bodyText.length, idx + p.length + 80);
      console.log(`  "${p}": FOUND -> ...${bodyText.slice(start, end).replace(/\s+/g, " ")}...`);
    }
  }
  return bodyText;
}

async function checkListing(browser, url, label) {
  const page = await newPage(browser);
  console.log(`\n=== ${label} ===`);
  console.log("URL:", url);
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    console.log("HTTP status:", resp && resp.status());
    console.log("Title:", await page.title());
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch((e) =>
      console.log("networkidle wait:", e.message)
    );
    await page.waitForTimeout(2500);

    await dumpBuybox(page, label);
    await grepPhrases(page, label);
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // 1) The actual tracked PS5 listing.
    await checkListing(
      browser,
      "https://www.amazon.in/Sony-CFI-1008A01R-PlayStation-5-console/dp/B08FV5GC28",
      "PS5 console (currently-tracked listing)"
    );

    // 2) A genuinely upcoming/pre-order product, to see what template Amazon
    // uses for that state at all (search results -> first pre-order hit).
    const page = await newPage(browser);
    try {
      console.log("\n=== Searching amazon.in for an upcoming/pre-order product ===");
      await page.goto("https://www.amazon.in/s?k=pre-order+game", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForTimeout(2000);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const hasPreorder = /pre-?order/i.test(bodyText);
      console.log("Search results page mentions pre-order anywhere:", hasPreorder);

      // Try to find a product link whose visible card text mentions pre-order.
      const cards = await page.locator("div[data-component-type='s-search-result']").all();
      console.log("Search result cards found:", cards.length);
      let picked = null;
      for (const card of cards.slice(0, 30)) {
        const txt = await card.innerText().catch(() => "");
        if (/pre-?order/i.test(txt)) {
          const link = card.locator("a.a-link-normal.s-no-outline, h2 a").first();
          const href = await link.getAttribute("href").catch(() => null);
          if (href) {
            picked = href.startsWith("http") ? href : `https://www.amazon.in${href}`;
            console.log("Picked pre-order card ->", picked);
            console.log("Card text snippet:", txt.replace(/\s+/g, " ").slice(0, 200));
            break;
          }
        }
      }
      if (picked) {
        await page.close();
        await checkListing(browser, picked, "Independently-found pre-order product");
      } else {
        console.log("No pre-order product card found in first 30 search results.");
        await page.close();
      }
    } catch (err) {
      console.log("ERROR during pre-order product search:", err.message);
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close();
  }
})();
