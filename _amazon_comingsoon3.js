// Follow-up 2: the earlier "will be released on" hit was inside a
// recommendation-carousel card (p13n-sc-uncoverable-faceout), not a real
// product's own buybox. Amazon's nav bar has a genuine "Pre-orders & New
// Releases" link (seen in body text earlier) - follow that to a real
// upcoming product's OWN PDP and inspect ITS buybox/#availability directly,
// to see the real per-product pre-order template (as opposed to a carousel
// card's line-clamped text).
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  try {
    // Amazon's video games "new releases" / "pre-order" node. Known stable
    // Amazon.in node id for Video Games > Pre-orders & New Releases.
    const url = "https://www.amazon.in/gp/new-releases/videogames";
    console.log("Loading:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    console.log("Title:", await page.title());

    // Find product links on this new-releases page.
    let links = await page.locator("a.a-link-normal").evaluateAll((els) =>
      Array.from(
        new Set(
          els
            .map((e) => e.getAttribute("href"))
            .filter((h) => h && h.includes("/dp/"))
        )
      )
    );
    console.log("Product links found:", links.length);
    console.log(links.slice(0, 10));

    if (!links.length) {
      console.log("No links found on new-releases page; trying search for pre-order instead.");
      await page.goto("https://www.amazon.in/s?k=pre-order+ps5", { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
      links = await page.locator("a.a-link-normal").evaluateAll((els) =>
        Array.from(new Set(els.map((e) => e.getAttribute("href")).filter((h) => h && h.includes("/dp/"))))
      );
      console.log("Fallback product links found:", links.length, links.slice(0, 10));
    }

    // Visit first few candidate PDPs and check each one's own buybox/availability
    // for future-release / pre-order language, plus record if genuinely absent.
    const toVisit = links.slice(0, 6).map((h) => (h.startsWith("http") ? h : `https://www.amazon.in${h}`));
    for (const pdpUrl of toVisit) {
      console.log("\n=== Checking PDP:", pdpUrl, "===");
      const p2 = await context.newPage();
      try {
        await p2.goto(pdpUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await p2.waitForTimeout(1800);
        console.log("Title:", await p2.title());
        for (const sel of ["#availability", "#buybox", "#desktop_buybox", "#outOfStock"]) {
          const count = await p2.locator(sel).count();
          if (count) {
            const txt = await p2.locator(sel).first().innerText().catch(() => "");
            console.log(`  ${sel}: ${JSON.stringify(txt.slice(0, 300))}`);
          }
        }
        const bodyText = await p2.locator("body").innerText().catch(() => "");
        const m = bodyText.match(/this item will be released on[^.]*\./i) || bodyText.match(/available on [a-z]+ \d{1,2},? \d{4}/i);
        console.log("  Release-date phrase in body:", m ? m[0] : "none found");
      } catch (err) {
        console.log("  ERROR:", err.message);
      } finally {
        await p2.close();
      }
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
