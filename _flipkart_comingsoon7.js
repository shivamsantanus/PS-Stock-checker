// Fix selector bug from script6 + capture network requests fired when
// clicking "Notify Me", to determine definitively what it does (stock
// alert subscription vs unrelated Q&A/price-alert widget).
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const URL = "https://www.flipkart.com/motorola-edge-70-max-pantone-dark-shadow-256-gb/p/itma23e20d630c2e";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  const requestsAfterClick = [];
  let clicked = false;
  page.on("request", (req) => {
    if (clicked) requestsAfterClick.push(req.method() + " " + req.url());
  });

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  const notifyLocator = page.locator("text=Notify Me").first();
  await notifyLocator.scrollIntoViewIfNeeded();

  // Snapshot surrounding DOM structure (siblings) before click for context.
  const beforeHtml = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const el = all.find((e) => {
      const own = [...e.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join("");
      return own.trim().toLowerCase() === "notify me";
    });
    if (!el) return "NOT FOUND";
    // climb to a parent with more than just this text, capture outerHTML
    let cur = el;
    for (let i = 0; i < 4 && cur.parentElement; i++) cur = cur.parentElement;
    return cur.outerHTML.slice(0, 2000);
  });
  console.log("--- Ancestor outerHTML (4 levels up, truncated 2000 chars) ---");
  console.log(beforeHtml);

  clicked = true;
  try {
    await notifyLocator.click({ timeout: 5000, force: true });
  } catch (e) {
    console.log("click error:", e.message);
  }
  await page.waitForTimeout(2500);

  console.log("\n--- Network requests fired after click ---");
  console.log(requestsAfterClick.length ? requestsAfterClick.join("\n") : "(none)");

  const toastOrModal = await page.evaluate(() => {
    const sel = document.querySelector("[role='dialog']") || document.querySelector("[class*='oast']") || document.querySelector("[class*='snackbar']");
    return sel ? sel.innerText.slice(0, 500) : null;
  });
  console.log("\nToast/modal text after click:", toastOrModal);

  const bodyTextAfter = await page.evaluate(() => document.body.innerText);
  console.log("\nBody text length after click:", bodyTextAfter.length, "(before ~2688)");

  await context.close();
  await browser.close();
})();
