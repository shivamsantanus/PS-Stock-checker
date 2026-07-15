const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const URL = "https://www.amazon.in/Sony-CFI-1008A01R-PlayStation-5-console/dp/B08FV5GC28";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
      const needle = "will be released on";
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.includes(needle)) {
          let el = node.parentElement;
          for (let i = 0; i < 10 && el; i++) {
            if (el.tagName === "A" && el.href) return { href: el.href, text: node.textContent.trim() };
            const a = el.querySelector && el.querySelector("a[href*='/dp/']");
            if (a) return { href: a.href, text: node.textContent.trim() };
            el = el.parentElement;
          }
          return { href: null, text: node.textContent.trim() };
        }
      }
      return null;
    });
    console.log("Found:", JSON.stringify(info, null, 2));

    if (info && info.href) {
      const p2 = await context.newPage();
      console.log("\n=== Visiting its own PDP:", info.href, "===");
      await p2.goto(info.href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p2.waitForTimeout(2000);
      console.log("Title:", await p2.title());
      for (const sel of ["#availability", "#buybox", "#desktop_buybox", "#outOfStock"]) {
        const count = await p2.locator(sel).count();
        if (count) {
          const txt = await p2.locator(sel).first().innerText().catch(() => "");
          console.log(`${sel}: ${JSON.stringify(txt.slice(0, 500))}`);
        } else {
          console.log(sel, ": not present");
        }
      }
      await p2.close();
    }
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
