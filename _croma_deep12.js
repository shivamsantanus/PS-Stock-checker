// Scratch investigation #12 - deep11 found the literal string "Galaxy Z Flip"
// somewhere on the mobiles category page's full body text, but the per-tile
// container-text climb came up empty for every tile (likely climbed too far
// / hit a lazy-render wrapper). This script re-visits the same category page,
// prints the context around every "Galaxy Z Flip"/"Galaxy Z Fold" occurrence,
// and separately looks for any anchor (anywhere on the page, not just /p/
// links) whose href or text mentions "fold" or "flip", to locate a real PDP
// URL if one exists.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  await page.goto("https://www.croma.com/mobiles-tablets/mobiles/c/10", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("goto err:", e.message.split("\n")[0]));
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
  }

  const fullText = await page.locator("body").innerText().catch(() => "");
  console.log("full text length:", fullText.length);
  const re = /galaxy z ?(flip|fold)[^\n]{0,60}/gi;
  for (const m of fullText.matchAll(re)) {
    const s = Math.max(0, m.index - 80);
    console.log("MATCH context:", JSON.stringify(fullText.slice(s, m.index + 100)));
  }

  // Any anchor mentioning fold/flip anywhere on the page (not just /p/).
  const foldFlipAnchors = await page.locator("a").evaluateAll((as) =>
    as
      .map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || "").replace(/\s+/g, " ").trim() }))
      .filter((x) => /fold|flip/i.test(x.text) || /fold|flip/i.test(x.href || ""))
  );
  console.log("\nAnchors mentioning fold/flip:", JSON.stringify(foldFlipAnchors.slice(0, 30), null, 2));

  // Also dump ALL /p/ product hrefs on this page (should be more than 10 if
  // we scrolled/loaded more).
  const allProductHrefs = await page.locator("a[href*='/p/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  console.log("\nAll distinct /p/ hrefs found after scrolling:", allProductHrefs.length);
  for (const h of allProductHrefs) console.log("  -", h);

  await browser.close();
  console.log("\nDONE.");
})();
