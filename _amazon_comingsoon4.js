const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  try {
    for (const term of ["grand theft auto 6", "GTA 6 PS5"]) {
      const page = await context.newPage();
      console.log("\n=== search:", term, "===");
      await page.goto(`https://www.amazon.in/s?k=${encodeURIComponent(term)}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
      const links = await page.locator("a.a-link-normal").evaluateAll((els) =>
        Array.from(new Set(els.map((e) => e.getAttribute("href")).filter((h) => h && h.includes("/dp/"))))
      );
      console.log("links:", links.slice(0, 5));
      for (const href of links.slice(0, 3)) {
        const url = href.startsWith("http") ? href : `https://www.amazon.in${href}`;
        const p2 = await context.newPage();
        try {
          await p2.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await p2.waitForTimeout(1500);
          console.log("  PDP title:", await p2.title());
          for (const sel of ["#availability", "#buybox"]) {
            const count = await p2.locator(sel).count();
            if (count) {
              const txt = await p2.locator(sel).first().innerText().catch(() => "");
              console.log(`   ${sel}: ${JSON.stringify(txt.slice(0,300))}`);
            }
          }
        } catch (e) { console.log("  ERROR:", e.message); }
        finally { await p2.close(); }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})();
