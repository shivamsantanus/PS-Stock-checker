// Follow-up to _amazon_comingsoon.js: the PS5 listing's own page incidentally
// showed "This item will be released on November 19, 2026." for a related
// "PS5 DISC DRIVE" item (probably a carousel/comparison widget). Find the
// exact DOM node(s) carrying that text and their selector/id/class so we know
// what to watch for if Amazon ever puts the PS5 console itself into that
// state.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const URL = "https://www.amazon.in/Sony-CFI-1008A01R-PlayStation-5-console/dp/B08FV5GC28";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-IN" });
  const page = await context.newPage();
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const results = await page.evaluate(() => {
      const needle = "will be released on";
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.includes(needle)) {
          let el = node.parentElement;
          // Walk up a few levels to find something with an id or a
          // reasonably specific class, capturing a small ancestor chain.
          const chain = [];
          let cur = el;
          for (let i = 0; i < 6 && cur; i++) {
            chain.push({
              tag: cur.tagName,
              id: cur.id || null,
              className: typeof cur.className === "string" ? cur.className : null,
              testId: cur.getAttribute ? cur.getAttribute("data-testid") : null,
            });
            cur = cur.parentElement;
          }
          out.push({
            text: node.textContent.trim(),
            chain,
          });
        }
      }
      return out;
    });

    console.log("Matches for 'will be released on':", results.length);
    console.log(JSON.stringify(results, null, 2));

    // Also grab the containing widget's outerHTML (truncated) for full context.
    const widgetHtml = await page.evaluate(() => {
      const needle = "will be released on";
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.includes(needle)) {
          let el = node.parentElement;
          for (let i = 0; i < 8 && el; i++) {
            if (el.id || (el.className && String(el.className).length > 0 && el.tagName === "DIV")) {
              // stop once we hit something with an id, likely a feature-div wrapper
              if (el.id) return { stoppedAt: "id", id: el.id, html: el.outerHTML.slice(0, 2000) };
            }
            el = el.parentElement;
          }
          return { stoppedAt: "none", html: node.parentElement.outerHTML.slice(0, 2000) };
        }
      }
      return null;
    });
    console.log("\nWidget context:\n", JSON.stringify(widgetHtml, null, 2));
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
