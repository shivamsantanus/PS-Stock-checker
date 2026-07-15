// Scratch investigation - Zepto "upcoming stock" / coming-soon signal.
// Goal: check live, right now, whether Zepto's PDP template exposes any
// "coming soon / launching soon / pre-order" badge distinct from the plain
// "Notify me when back in stock" OOS text already read via `.KQfnF.ckhcV` in
// targets.ts (outOfStockValues: ["notify me","out of stock"]).
//
// Part 1: drive the real pincode-apply flow (same as targets.ts preActions)
// against both tracked PS5 listings across a few pincodes, dump the buy-box
// text AND a wider surrounding chunk of visible page text, looking for any
// adjacent "coming soon"/"launching soon"/"pre-order" badge.
//
// Part 2: separately, browse/search Zepto for a genuinely-unreleased product
// to see what template Zepto actually uses for a real pre-launch state, since
// PS5 (already released, was in stock before) may never hit that state itself.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PHRASES = [
  "coming soon",
  "launching soon",
  "pre-order",
  "preorder",
  "pre order",
  "notify me",
  "out of stock",
  "back in stock",
  "sold out",
  "unavailable",
  "launch",
  "available soon",
  "will be available",
  "not yet launched",
  "get notified",
];

const BUYBOX_SELECTOR = ".KQfnF.ckhcV";

async function newPage(browser) {
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-IN",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" },
  });
  return context.newPage();
}

async function applyPincode(page, pincode) {
  console.log(`  Applying pincode ${pincode}...`);
  try {
    await page.click("[data-testid='user-address']", { timeout: 15000 });
    await page.fill("[data-testid='address-search-input'] input", pincode, { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.click("[data-testid='address-search-item']", { timeout: 15000 });
    await page.waitForTimeout(7000);
    console.log("  Pincode apply flow completed.");
    return true;
  } catch (err) {
    console.log("  Pincode apply FAILED:", err.message);
    return false;
  }
}

async function dumpBuybox(page, label) {
  console.log(`\n  --- ${label}: buy-box selector "${BUYBOX_SELECTOR}" ---`);
  const count = await page.locator(BUYBOX_SELECTOR).count();
  console.log(`  match count: ${count}`);
  if (count) {
    const text = await page.locator(BUYBOX_SELECTOR).first().innerText().catch((e) => `<error: ${e.message}>`);
    console.log(`  buy-box text: ${JSON.stringify(text)}`);
  } else {
    console.log("  SELECTOR DID NOT MATCH - it may have rotated. Dumping fallback candidates...");
    // Try to find something with a hashed class near "Add to Cart"/"Notify"/price.
    const candidates = await page.getByText(/add to cart|notify me|out of stock/i).all();
    console.log(`  fallback text-matched elements: ${candidates.length}`);
    for (const el of candidates.slice(0, 10)) {
      const txt = await el.innerText().catch(() => "");
      const cls = await el.evaluate((e) => e.className).catch(() => "");
      const tag = await el.evaluate((e) => e.tagName).catch(() => "?");
      console.log(`    <${tag} class="${String(cls).slice(0, 100)}"> "${txt.slice(0, 80)}"`);
    }
  }
}

async function dumpWiderChunk(page, label) {
  console.log(`\n  --- ${label}: wider surrounding text (parent chain of buy-box) ---`);
  const count = await page.locator(BUYBOX_SELECTOR).count();
  if (!count) {
    console.log("  (buy-box not present, skipping parent-chain dump)");
    return;
  }
  // Walk up a few ancestor levels from the buy-box and dump each level's text,
  // to catch a badge that sits just outside .KQfnF.ckhcV but still "near" it.
  const chunks = await page.locator(BUYBOX_SELECTOR).first().evaluate((el) => {
    const out = [];
    let cur = el;
    for (let i = 0; i < 5 && cur; i++) {
      out.push({ level: i, tag: cur.tagName, className: String(cur.className).slice(0, 120), text: cur.innerText || "" });
      cur = cur.parentElement;
    }
    return out;
  });
  for (const c of chunks) {
    console.log(`  [level ${c.level}] <${c.tag} class="${c.className}"> text (${c.text.length} chars):`);
    console.log(`    ${JSON.stringify(c.text.replace(/\s+/g, " ").slice(0, 500))}`);
  }
}

async function grepPhrases(page, label) {
  console.log(`\n  --- ${label}: phrase search over visible body text ---`);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();
  for (const p of PHRASES) {
    const idx = lower.indexOf(p);
    if (idx === -1) {
      console.log(`    "${p}": NOT found`);
    } else {
      const start = Math.max(0, idx - 80);
      const end = Math.min(bodyText.length, idx + p.length + 80);
      console.log(`    "${p}": FOUND -> ...${bodyText.slice(start, end).replace(/\s+/g, " ")}...`);
    }
  }
}

async function checkListing(browser, url, label, pincode) {
  const page = await newPage(browser);
  console.log(`\n=== ${label} | pincode ${pincode} ===`);
  console.log("URL:", url);
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    console.log("HTTP status:", resp && resp.status());
    console.log("Title:", await page.title());
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch((e) =>
      console.log("networkidle wait:", e.message)
    );
    await page.waitForTimeout(2000);

    console.log("\n  -- BEFORE applying pincode (default view) --");
    await dumpBuybox(page, label);

    const applied = await applyPincode(page, pincode);
    console.log(`\n  -- AFTER applying pincode ${pincode} (applied=${applied}) --`);
    await dumpBuybox(page, label);
    await dumpWiderChunk(page, label);
    await grepPhrases(page, label);
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await page.close();
  }
}

async function findUpcomingProduct(browser) {
  console.log("\n\n########## PART 2: searching Zepto for a genuinely upcoming/coming-soon product ##########");
  const page = await newPage(browser);
  try {
    // Apply a pincode first via the homepage so search results are location-aware.
    await page.goto("https://www.zepto.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    await applyPincode(page, "560075").catch((e) => console.log("homepage pincode apply error:", e.message));

    const queries = ["launching soon", "coming soon", "iphone 17", "pre order", "upcoming"];
    for (const q of queries) {
      console.log(`\n--- Searching Zepto for: "${q}" ---`);
      try {
        await page.goto(`https://www.zepto.com/search?query=${encodeURIComponent(q)}`, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page.waitForTimeout(3000);
        const bodyText = await page.locator("body").innerText().catch(() => "");
        const lower = bodyText.toLowerCase();
        for (const p of ["coming soon", "launching soon", "pre-order", "preorder", "notify me"]) {
          if (lower.includes(p)) {
            const idx = lower.indexOf(p);
            console.log(`  "${p}" FOUND on search results page -> ...${bodyText.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, " ")}...`);
          }
        }
        // Try to find a product card mentioning "coming soon" / "launching soon" and open it.
        const cardMatch = await page.getByText(/coming soon|launching soon/i).all();
        console.log(`  Elements matching /coming soon|launching soon/i: ${cardMatch.length}`);
        if (cardMatch.length) {
          for (const el of cardMatch.slice(0, 5)) {
            const txt = await el.innerText().catch(() => "");
            console.log(`    match text: "${txt.slice(0, 100)}"`);
          }
          // Try to click the closest product card link containing this badge and inspect its PDP.
          const card = cardMatch[0];
          const link = await card.evaluate((el) => {
            let cur = el;
            for (let i = 0; i < 8 && cur; i++) {
              if (cur.tagName === "A" && cur.getAttribute("href")) return cur.getAttribute("href");
              cur = cur.parentElement;
            }
            return null;
          }).catch(() => null);
          console.log("  Nearest ancestor <a> href:", link);
          if (link) {
            const fullUrl = link.startsWith("http") ? link : `https://www.zepto.com${link}`;
            console.log(`  Opening PDP: ${fullUrl}`);
            const pdp = await newPage(browser);
            try {
              await pdp.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
              await pdp.waitForTimeout(3000);
              console.log("  PDP title:", await pdp.title());
              const pdpBody = await pdp.locator("body").innerText().catch(() => "");
              console.log("  PDP body text (first 1500 chars):", JSON.stringify(pdpBody.replace(/\s+/g, " ").slice(0, 1500)));
              console.log(`\n  --- PDP: buy-box selector "${BUYBOX_SELECTOR}" ---`);
              await dumpBuybox(pdp, "upcoming-product-PDP");
            } catch (err) {
              console.log("  PDP ERROR:", err.message);
            } finally {
              await pdp.close();
            }
            return; // Found and inspected one - stop searching further queries.
          }
        }
      } catch (err) {
        console.log(`  ERROR searching "${q}":`, err.message);
      }
    }
    console.log("\nNo 'coming soon'/'launching soon' product card found via any search query tried.");
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const listings = [
      { url: "https://www.zepto.com/pn/playstation-5-console-standard/pvid/ad968d7d-c5d8-415e-b7d4-58f84ff13076", label: "PS5 Standard Edition" },
      { url: "https://www.zepto.com/pn/playstation-5-console-digital/pvid/4dd0b8da-d86d-4d40-8ab9-8413ebeec4df", label: "PS5 Digital Edition" },
    ];
    const pincodes = ["560075", "147002"];

    for (const listing of listings) {
      for (const pincode of pincodes) {
        await checkListing(browser, listing.url, listing.label, pincode);
      }
    }

    await findUpcomingProduct(browser);
  } finally {
    await browser.close();
  }
})();
