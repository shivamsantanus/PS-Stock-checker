// Scratch investigation #11 - fixes deep10's empty tile-text extraction
// (text lives in a sibling/parent container, not the raw <a> innerText) and
// widens the net: full homepage body text + ALL anchors (not just header
// nav) for promo banners, plus the mobiles category page with correctly
// extracted tile text, hunting for a genuine pre-order/coming-soon product
// (e.g. a just-announced Galaxy Z Fold/Flip, which Samsung/retailers in
// India typically open pre-booking for right around this time of year).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  console.log("########## homepage: full text + all anchors ##########");
  await page.goto("https://www.croma.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("goto err:", e.message.split("\n")[0]));
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
  }

  const homeText = await page.locator("body").innerText().catch(() => "");
  console.log("homepage body text length:", homeText.length);
  const kw = /(coming soon|notify me|pre-?book|pre-?order|launching soon|available soon|galaxy z ?fold|galaxy z ?flip)/gi;
  const homeMatches = [...homeText.matchAll(kw)].map((m) => m[0]);
  console.log("homepage keyword matches:", JSON.stringify(homeMatches));
  // print context around first few matches
  let idx = 0;
  for (const m of homeText.matchAll(kw)) {
    if (idx++ >= 8) break;
    const s = Math.max(0, m.index - 60);
    console.log("  ...context:", JSON.stringify(homeText.slice(s, m.index + 80)));
  }

  const allAnchors = await page.locator("a[href]").evaluateAll((as) =>
    as.map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || "").replace(/\s+/g, " ").trim() })).filter((x) => x.href)
  );
  console.log("\ntotal anchors on homepage:", allAnchors.length);
  const interestingAnchors = allAnchors.filter((a) => kw.test(a.text) || kw.test(a.href || ""));
  console.log("anchors matching keywords:", JSON.stringify(interestingAnchors.slice(0, 20)));

  console.log("\n########## mobiles category page: properly-scoped tile text ##########");
  await page.goto("https://www.croma.com/mobiles-tablets/mobiles/c/10", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("goto err:", e.message.split("\n")[0]));
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
  }

  // Walk each /p/ anchor up to a reasonably-sized ancestor container and grab
  // ITS innerText (covers "text lives in sibling" and "text lives in parent"
  // cases alike).
  const tileTexts = await page.locator("a[href*='/p/']").evaluateAll((as) =>
    as.slice(0, 60).map((a) => {
      let node = a;
      // climb up to 4 levels looking for a container with non-trivial text
      for (let i = 0; i < 4; i++) {
        if (node.parentElement) node = node.parentElement;
      }
      return { href: a.getAttribute("href"), containerText: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200) };
    })
  );
  console.log("Tile container text (climbed 4 ancestors), first 60:");
  for (const t of tileTexts) console.log("  -", t.href, "|", t.containerText);

  const catFullText = await page.locator("body").innerText().catch(() => "");
  const catMatches = [...catFullText.matchAll(kw)].map((m) => m[0]);
  console.log("\ncategory page keyword matches:", JSON.stringify(catMatches));

  await browser.close();
  console.log("\nDONE.");
})();
