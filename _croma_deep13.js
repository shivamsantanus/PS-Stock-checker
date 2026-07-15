// Scratch investigation #13 - deep11 caught "Galaxy Z Flip" in the mobiles
// category page's full text once; deep12 immediately after got a much
// shorter, mostly-empty render (croma.com page loads are known-flaky under
// automation per the task brief). This script retries the same page load up
// to 3 times, waiting for the body text to reach a reasonable length before
// scanning, to reliably reproduce and contextualize the "Galaxy Z Flip"
// mention and find any real PDP link near it.
const { chromium } = require("playwright");

async function loadWithRetry(page, url, minLen = 5000, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    console.log(`\nattempt ${i}: goto ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("  goto err:", e.message.split("\n")[0]));
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    for (let s = 0; s < 8; s++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    const text = await page.locator("body").innerText().catch(() => "");
    console.log(`  body text length: ${text.length}`);
    if (text.length >= minLen) return text;
    await page.waitForTimeout(1500);
  }
  return await page.locator("body").innerText().catch(() => "");
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  const fullText = await loadWithRetry(page, "https://www.croma.com/mobiles-tablets/mobiles/c/10");

  const re = /galaxy z ?(flip|fold)[^\n]{0,80}/gi;
  const matches = [...fullText.matchAll(re)];
  console.log("\nGalaxy Z Flip/Fold matches:", matches.length);
  for (const m of matches) {
    const s = Math.max(0, m.index - 150);
    console.log("MATCH context:", JSON.stringify(fullText.slice(s, m.index + 150)));
  }

  const allProductHrefs = await page.locator("a[href*='/p/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  console.log("\nAll distinct /p/ hrefs on final render:", allProductHrefs.length);
  for (const h of allProductHrefs) console.log("  -", h);

  const foldFlipAnchors = await page.locator("a").evaluateAll((as) =>
    as
      .map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || "").replace(/\s+/g, " ").trim() }))
      .filter((x) => /fold|flip/i.test(x.text) || /fold|flip/i.test(x.href || ""))
  );
  console.log("\nAnchors mentioning fold/flip:", JSON.stringify(foldFlipAnchors, null, 2));

  await browser.close();
  console.log("\nDONE.");
})();
