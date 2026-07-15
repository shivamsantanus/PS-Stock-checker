// Drill into the exact DOM location/selector of the "Notify Me" element
// found on the Motorola Edge 70 Max (OutOfStock) page, to determine whether
// it's a genuine "notify me when back in stock" CTA tied to the buy box,
// or something unrelated (e.g. a Q&A follow-up feature).
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const URL = "https://www.flipkart.com/motorola-edge-70-max-pantone-dark-shadow-256-gb/p/itma23e20d630c2e";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const hits = all.filter((el) => {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join("");
      return own.trim().toLowerCase() === "notify me";
    });
    return hits.map((el) => {
      const path = [];
      let cur = el;
      for (let i = 0; i < 6 && cur; i++) {
        path.push({
          tag: cur.tagName,
          className: cur.className && typeof cur.className === "string" ? cur.className : String(cur.className),
          id: cur.id || null,
          textSnippet: (cur.innerText || "").trim().slice(0, 150),
        });
        cur = cur.parentElement;
      }
      return path;
    });
  });

  console.log("Notify Me element ancestor chains:");
  console.log(JSON.stringify(info, null, 2));

  // Also check for any "Add to Cart" / "Buy Now" buttons anywhere (to
  // confirm none exist at all for this OutOfStock product).
  const cta = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, a, div[role='button']")];
    return btns
      .map((el) => (el.innerText || "").trim())
      .filter((t) => t && t.length < 40)
      .filter((t, i, arr) => arr.indexOf(t) === i);
  });
  console.log("\nAll short unique clickable-element texts on page:");
  console.log(JSON.stringify(cta, null, 2));

  await context.close();
  await browser.close();
})();
