// Scratch investigation #4 - Croma cookie-reuse test:
// 1. Headful real-Chrome session mints Akamai cookies (_abck, bm_sz) and we
//    also log api.croma.com XHRs + the buy-box state (incl. pincode flow).
// 2. Save storage state to scratch.
// 3. Re-run the same product page HEADLESS with those cookies to see if the
//    Akamai edge accepts them (this is what the Target.cookies field needs).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PRODUCT = "https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320";
const STATE_FILE = path.join(__dirname, "_croma_state.json");
const PINCODE = process.argv[2] || "560075";

async function dumpStockState(page, tag) {
  const ctas = await page.getByText(/add to cart|notify me|out of stock|sold out|buy now|coming soon/i).all();
  console.log(`[${tag}] CTA matches:`, ctas.length);
  for (const el of ctas.slice(0, 10)) {
    const info = await el
      .evaluate((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 90), txt: (e.innerText || "").trim().slice(0, 50), visible: !!e.offsetParent }))
      .catch(() => null);
    if (info) console.log("   -", JSON.stringify(info));
  }
}

(async () => {
  // ---- Phase 1: headful, mint cookies ----
  const headful = await chromium.launch({ headless: false, channel: "chrome" });
  const ctx1 = await headful.newContext({ locale: "en-US" });
  const page1 = await ctx1.newPage();
  page1.on("response", (res) => {
    if (/api\.croma\.com/.test(res.url()) && /pdp|inventory|stock|deliver|pincode|serviceab/i.test(res.url())) {
      console.log("[headful] API:", res.status(), res.url().slice(0, 170));
    }
  });
  const r1 = await page1.goto(PRODUCT, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("[headful] status:", r1 && r1.status());
  await page1.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page1.waitForTimeout(3000);
  await dumpStockState(page1, "headful");

  // Try the pincode flow if an input exists.
  const pinInput = page1.locator("input[placeholder*='pin' i], input[id*='pincode' i], input[class*='pincode' i]").first();
  if ((await pinInput.count()) > 0) {
    console.log("[headful] pincode input found, applying", PINCODE);
    await pinInput.fill(PINCODE).catch((e) => console.log("fill failed:", e.message.split("\n")[0]));
    await page1.waitForTimeout(1000);
    await pinInput.press("Enter").catch(() => {});
    await page1.waitForTimeout(4000);
    await dumpStockState(page1, "headful+pincode");
  } else {
    console.log("[headful] no pincode input found on PDP");
  }

  await ctx1.storageState({ path: STATE_FILE });
  console.log("[headful] storage state saved");
  await headful.close();

  // ---- Phase 2: headless with minted cookies ----
  const headless = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx2 = await headless.newContext({ locale: "en-US", storageState: STATE_FILE });
  const page2 = await ctx2.newPage();
  const r2 = await page2.goto(PRODUCT, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
    console.log("[headless] goto error:", e.message.split("\n")[0]);
    return null;
  });
  console.log("[headless+cookies] status:", r2 && r2.status());
  console.log("[headless+cookies] title:", await page2.title());
  if (r2 && r2.status() === 200) {
    await page2.waitForTimeout(4000);
    await dumpStockState(page2, "headless+cookies");
  }
  await headless.close();

  // ---- Phase 3: axios with just the Akamai cookies ----
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const cookieHeader = state.cookies
    .filter((c) => c.domain.includes("croma.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const axios = require("axios");
  const res = await axios.get(PRODUCT, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookieHeader,
    },
    timeout: 15000,
    validateStatus: () => true,
  });
  console.log("[axios+cookies] status:", res.status);
})();
