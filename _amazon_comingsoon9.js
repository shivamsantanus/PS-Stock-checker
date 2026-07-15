const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const URL = "https://www.amazon.in/Grand-Theft-Auto-Standard-PlayStation/dp/B0H6X8VNQC";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    const info = await page.evaluate(() => {
      function chainFor(el) {
        const chain = [];
        let cur = el;
        for (let i = 0; i < 8 && cur; i++) {
          chain.push({ tag: cur.tagName, id: cur.id || null, className: typeof cur.className === "string" ? cur.className : null });
          cur = cur.parentElement;
        }
        return chain;
      }
      const results = {};
      for (const needle of ["will be released on", "Pre-order now"]) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node, found = null;
        while ((node = walker.nextNode())) {
          if (node.textContent && node.textContent.includes(needle)) {
            found = { text: node.textContent.trim(), chain: chainFor(node.parentElement) };
            break;
          }
        }
        results[needle] = found;
      }
      // Also list all ids present, to compare against #availability/#buybox universe.
      results.allIds = Array.from(document.querySelectorAll("[id]")).map((e) => e.id).filter(Boolean);
      return results;
    });
    console.log(JSON.stringify(info, null, 2));
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
