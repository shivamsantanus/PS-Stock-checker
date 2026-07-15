// Scratch investigation #3 - Reliance Digital: find the real containers.
// deep2 learned: #product exists as an id but has no innerText, and the
// "Apply" <p> is NOT inside #delivery. Scroll to trigger lazy rendering,
// then dump the parent chain of the pincode input and the Apply element,
// plus whatever the main CTA (add to cart / notify) actually is.
const { chromium } = require("playwright");

const URL = "https://www.reliancedigital.in/product/sony-playstation-ps5-slim-console-luh1rv-7537998";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PINCODE = process.argv[2] || "560075";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "en-US" });
  const page = await context.newPage();
  page.on("response", (res) => {
    const u = res.url();
    if (/reliancedigital\.in\/api/i.test(u)) console.log("API:", res.status(), u.slice(0, 180));
  });
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    // Scroll down in steps to trigger any lazy-rendered sections, then back up.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);

    // Parent chain of the pincode input.
    const chain = await page.locator(".delivery-pincode-input").first().evaluate((e) => {
      const out = [];
      let n = e;
      for (let i = 0; i < 8 && n; i++) {
        out.push(`${n.tagName}${n.id ? "#" + n.id : ""}.${String(n.className).split(" ").slice(0, 3).join(".")}`);
        n = n.parentElement;
      }
      return out;
    });
    console.log("Pincode input parent chain:", chain.join("  <-  "));

    // Everything with 'Apply' text - full parent context.
    const applies = await page.getByText(/^apply$/i).all();
    console.log("Apply elements:", applies.length);
    for (const el of applies) {
      const info = await el.evaluate((e) => {
        const chain = [];
        let n = e;
        for (let i = 0; i < 6 && n; i++) {
          chain.push(`${n.tagName}${n.id ? "#" + n.id : ""}.${String(n.className).split(" ").slice(0, 3).join(".")}`);
          n = n.parentElement;
        }
        return { visible: !!e.offsetParent, chain: chain.join(" <- ") };
      });
      console.log(" -", JSON.stringify(info));
    }

    // The whole right-hand buy column: find price element and dump its section.
    const priceEls = await page.locator("[class*='price'], [class*='Price']").evaluateAll((els) =>
      els.slice(0, 10).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 60), txt: (e.innerText || "").trim().slice(0, 40) }))
    );
    console.log("Price-ish elements:", JSON.stringify(priceEls, null, 2));

    // Buttons page-wide (visible only).
    const allButtons = await page.locator("button").evaluateAll((els) =>
      els
        .filter((e) => e.offsetParent)
        .map((e) => ({ cls: String(e.className).slice(0, 70), txt: (e.innerText || "").trim().slice(0, 40) }))
    );
    console.log("Visible <button> elements:", JSON.stringify(allButtons, null, 2));

    // Fill pincode and press Enter as an alternative to clicking Apply.
    await page.locator(".delivery-pincode-input").first().fill(PINCODE);
    await page.waitForTimeout(800);
    const applyBtn = page.getByText(/^apply$/i).first();
    if ((await applyBtn.count()) > 0) {
      await applyBtn.click({ timeout: 5000 }).catch(async (e) => {
        console.log("Apply click failed:", e.message.split("\n")[0], "- trying Enter key");
        await page.locator(".delivery-pincode-input").first().press("Enter");
      });
    } else {
      await page.locator(".delivery-pincode-input").first().press("Enter");
    }
    console.log("Pincode submitted:", PINCODE);
    await page.waitForTimeout(7000);

    // Dump delivery area + CTA state after apply.
    const deliverySection = await page.locator(".delivery-pincode-input").first().evaluate((e) => {
      let n = e;
      for (let i = 0; i < 5 && n.parentElement; i++) n = n.parentElement;
      return (n.innerText || "").slice(0, 600);
    }).catch(() => "<gone>");
    console.log("---- Delivery section after apply ----");
    console.log(deliverySection);

    const ctas = await page.getByText(/add to cart|notify me|out of stock|sold out|buy now|coming soon/i).all();
    console.log("Page-wide stock-CTA matches:", ctas.length);
    for (const el of ctas.slice(0, 15)) {
      const info = await el.evaluate((e) => ({
        tag: e.tagName,
        cls: String(e.className).slice(0, 70),
        txt: (e.innerText || "").trim().slice(0, 50),
        visible: !!e.offsetParent,
      })).catch(() => null);
      if (info) console.log(" -", JSON.stringify(info));
    }
    const visibleButtonsAfter = await page.locator("button").evaluateAll((els) =>
      els.filter((e) => e.offsetParent).map((e) => ({ cls: String(e.className).slice(0, 70), txt: (e.innerText || "").trim().slice(0, 40) }))
    );
    console.log("Visible <button> elements AFTER:", JSON.stringify(visibleButtonsAfter, null, 2));
  } catch (err) {
    console.log("ERROR:", err.message);
  } finally {
    await browser.close();
  }
})();
