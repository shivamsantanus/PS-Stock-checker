// Scratch investigation #7 - Croma OMS promise API:
// 1. Dump the FULL request body the PDP sends (deep6 truncated it).
// 2. Find an in-stock control product via the search API (with cookies) and
//    capture the OMS response shape for an available item.
// 3. Test the OMS POST via axios WITH and WITHOUT the Akamai cookie jar, to
//    learn whether cookie minting is a hard requirement.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const STATE_FILE = path.join(__dirname, "_croma_state.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const OMS_URL = "https://api.croma.com/inventory/oms/v2/tms/details-pwa/";
const SUB_KEY = "1131858141634e2abe2efb2b3a2a2a5d";

(async () => {
  // ---- Phase 1: headful - capture FULL OMS request body from a PDP ----
  let fullBody = null;
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  page.on("request", (req) => {
    if (req.url() === OMS_URL && !fullBody) {
      fullBody = req.postData();
      console.log("FULL OMS REQUEST BODY:\n", fullBody);
    }
  });
  await page.goto("https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await context.storageState({ path: STATE_FILE }); // refresh cookie jar
  await browser.close();

  if (!fullBody) {
    console.log("No OMS request captured - aborting axios phase.");
    return;
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const cookieHeader = state.cookies
    .filter((c) => c.domain.includes("croma.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const baseHeaders = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "oms-apim-subscription-key": SUB_KEY,
    Referer: "https://www.croma.com/",
    Origin: "https://www.croma.com",
  };

  // ---- Phase 2: axios replay - with cookies vs without ----
  for (const [label, headers] of [
    ["axios WITH cookies", { ...baseHeaders, Cookie: cookieHeader }],
    ["axios WITHOUT cookies", baseHeaders],
  ]) {
    try {
      const res = await axios.post(OMS_URL, fullBody, { headers, timeout: 15000, validateStatus: () => true });
      const s = JSON.stringify(res.data);
      console.log(`\n[${label}] status:`, res.status, "| unavailable:", /unavailableReason/.test(s), "| body:", s.slice(0, 300));
    } catch (e) {
      console.log(`[${label}] ERROR:`, e.message);
    }
  }

  // ---- Phase 3: control product - find something in stock via search ----
  try {
    const res = await axios.get(
      "https://api.croma.com/searchservices/v1/search?currentPage=0&query=dualsense%3Arelevance&fields=FULL&channel=WEB&channelCode=collection",
      { headers: { ...baseHeaders, Cookie: cookieHeader }, timeout: 15000, validateStatus: () => true }
    );
    console.log("\n[search] status:", res.status);
    const products = res.data?.products || res.data?.searchPageData?.results || [];
    const first = products[0];
    console.log("[search] first product:", JSON.stringify(first)?.slice(0, 300));
    const code = first?.code;
    if (code) {
      const body = JSON.parse(fullBody);
      // retarget every promise line at the control product
      const lines = body.promise.promiseLines.promiseLine;
      for (const l of lines) l.itemID = String(code);
      const res2 = await axios.post(OMS_URL, JSON.stringify(body), {
        headers: { ...baseHeaders, Cookie: cookieHeader },
        timeout: 15000,
        validateStatus: () => true,
      });
      console.log(`\n[control ${code}] status:`, res2.status);
      console.log(JSON.stringify(res2.data).slice(0, 1500));
    }
  } catch (e) {
    console.log("[search] ERROR:", e.message);
  }
})();
