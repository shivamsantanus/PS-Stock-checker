// Scratch investigation #10 - deep9's search-service API now 400s even for
// deep7's own previously-working query (likely needs a short-lived token we
// don't have) and the on-page search box was unreliable/timed out. This
// script skips search entirely: it goes headful to Croma's homepage, dumps
// the real top-nav links (no guessing), follows one likely category
// (mobiles/phones), and scans EVERY product tile's visible text on that
// listing page for pre-order/coming-soon/notify-me wording - the most direct
// way to find a genuine candidate without relying on flaky search endpoints.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  console.log("########## homepage ##########");
  const home = await page.goto("https://www.croma.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
    console.log("homepage goto error:", e.message.split("\n")[0]);
    return null;
  });
  console.log("homepage status:", home && home.status());
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Dump every top-level nav link (text + href) so we can pick a real
  // category URL instead of guessing one.
  const allNavLinks = await page.locator("header a, nav a").evaluateAll((as) =>
    as
      .map((a) => ({ text: (a.innerText || "").trim(), href: a.getAttribute("href") }))
      .filter((x) => x.text && x.href)
  );
  // De-dup by href.
  const seen = new Set();
  const uniqLinks = [];
  for (const l of allNavLinks) {
    if (!seen.has(l.href)) {
      seen.add(l.href);
      uniqLinks.push(l);
    }
  }
  console.log("Top nav/header links (deduped):", uniqLinks.length);
  for (const l of uniqLinks.slice(0, 60)) console.log("  -", l.text.slice(0, 30), "=>", l.href);

  // Find a mobiles/phones-ish category link to visit.
  const mobileLink = uniqLinks.find((l) => /mobile|smartphone/i.test(l.text) && /\/c\//i.test(l.href || ""));
  const targetHref = mobileLink ? mobileLink.href : null;
  console.log("\nChosen mobiles category link:", targetHref);

  const categoryUrl = targetHref
    ? targetHref.startsWith("http")
      ? targetHref
      : `https://www.croma.com${targetHref}`
    : "https://www.croma.com/mobiles-tablets/mobiles/c/10";

  console.log(`\n########## category listing: ${categoryUrl} ##########`);
  const catResp = await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
    console.log("category goto error:", e.message.split("\n")[0]);
    return null;
  });
  console.log("category status:", catResp && catResp.status());
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // Scroll a bit to trigger lazy-loaded tiles.
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(600);
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log("category body text length:", bodyText.length);

  // Scan for pre-order-ish keywords anywhere on the listing.
  const keywordRegex = /coming soon|notify me|pre-?book|pre-?order|launching soon|available soon/gi;
  const matches = bodyText.match(keywordRegex) || [];
  console.log("Keyword matches on category page:", matches.length, JSON.stringify(matches.slice(0, 20)));

  // Also grab product tile anchors + their full text, to manually inspect
  // for badges even if wording differs from our regex.
  const tiles = await page.locator("a[href*='/p/']").evaluateAll((as) =>
    as.slice(0, 40).map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140) }))
  );
  console.log("\nProduct tile sample (first 40 with /p/ links):");
  for (const t of tiles) console.log("  -", t.href, "|", t.text);

  await browser.close();
  console.log("\nDONE.");
})();
