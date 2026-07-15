// Final drill-down: click the "Notify Me" element on the OutOfStock
// Motorola Edge 70 Max page and see what happens (modal? nothing? navigates
// to login?) - to settle whether it's a stock-alert CTA or an unrelated
// widget (e.g. Q&A notifications, price-drop alert, etc).
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

  // Scroll the "Notify Me" element into view and inspect surrounding
  // section heading (walk up until we find a recognizable section title).
  const context2 = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const el = all.find((e) => {
      const own = [...e.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join("");
      return own.trim().toLowerCase() === "notify me";
    });
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // Look at the broader ancestor (10 levels up) for a section heading.
    let cur = el;
    let bigParentText = "";
    for (let i = 0; i < 10 && cur; i++) {
      cur = cur.parentElement;
    }
    bigParentText = cur ? cur.innerText.slice(0, 800) : "(no ancestor)";
    return { rectY: rect.y, bigParentText };
  });
  console.log("Notify Me context (10 levels up ancestor text, first 800 chars):");
  console.log(context2 ? context2.bigParentText : "NOT FOUND");
  console.log("Y position on page:", context2 ? context2.rectY : "n/a");

  // Try clicking it and see what happens (new URL? modal? login redirect?).
  try {
    const notifyLocator = page.locator("text=Notify Me").first();
    await notifyLocator.scrollIntoViewIfNeeded();
    const before = page.url();
    await notifyLocator.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    const after = page.url();
    console.log("\nURL before click:", before);
    console.log("URL after click:", after);
    const modalText = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog'], ._3e3q');");
      return dialog ? dialog.innerText.slice(0, 500) : null;
    });
    console.log("Modal text (if any):", modalText);
  } catch (e) {
    console.log("Click attempt failed/no-op:", e.message);
  }

  await context.close();
  await browser.close();
})();
