import { Page, chromium } from "playwright";
import { config } from "../config";
import { logger } from "../logger";
import { PincodeEntry, loadPincodeEntries, savePincodeEntries } from "../pincodeStore";

/**
 * Fills in `lat`/`lon` on every quick-commerce pincode row that's missing
 * them, by asking Blinkit's own geocoder the exact question its location
 * picker asks: autoSuggest(query) -> take the first suggestion -> info(
 * place_id) -> read `coordinate`. Live-verified 2026-08-07 that this returns
 * the identical coordinate the real picker writes into its gr_1_lat/gr_1_lon
 * cookies (12.970632199999999,77.6529303 for 560075), so an API check keyed
 * on it sees the same dark store a human at that address would.
 *
 * Run with: npm run resolve-latlon
 *
 * This is a ONE-TIME, opt-in admin task, not part of the check cycle - the
 * coordinate for an address doesn't change, and re-resolving
 * on every run would be pointless load on someone else's geocoder.
 */

const AUTOSUGGEST_URL = "https://blinkit.com/location/autoSuggest";
const INFO_URL = "https://blinkit.com/location/info";

// Blinkit's autoSuggest biases results toward the caller's current location,
// so an unqualified "560001" can resolve to a same-numbered pincode in
// another state. Anchoring the bias to Bengaluru keeps the first suggestion
// the intended one for this project's (currently Bangalore-only) rows.
const BIAS_LAT = 12.9716;
const BIAS_LON = 77.5946;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Same constraint as the availability check itself: Blinkit's edge rejects
 * Node's TLS fingerprint (axios/undici/Playwright APIRequestContext all 403,
 * regardless of headers), so these calls have to originate from a real
 * Chromium page on blinkit.com. See CheckStrategy in types.ts.
 */
async function getJson(page: Page, url: string): Promise<any> {
  const res = await page.evaluate(async (u: string) => {
    const r = await fetch(u, { headers: { Accept: "application/json" }, credentials: "include" });
    return { status: r.status, text: await r.text() };
  }, url);

  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${url}`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${res.text.slice(0, 120)}`);
  }
}

async function resolveOne(page: Page, entry: PincodeEntry): Promise<{ lat: number; lon: number } | null> {
  const query = entry.searchText || entry.pincode;

  const suggestUrl = `${AUTOSUGGEST_URL}?query=${encodeURIComponent(query)}&lat=${BIAS_LAT}&lng=${BIAS_LON}&session_token=`;
  const suggest = await getJson(page, suggestUrl);

  const first = suggest?.ui_data?.suggestions?.[0];
  const placeId = first?.meta?.place_id;
  if (!placeId) {
    logger.warn(`No suggestion returned for "${query}"`, { id: entry.id });
    return null;
  }

  const infoUrl =
    `${INFO_URL}?place_id=${encodeURIComponent(placeId)}` +
    `&title=${encodeURIComponent(first?.title?.text ?? "")}` +
    `&description=${encodeURIComponent(first?.subtitle?.text ?? "")}` +
    `&is_pin_moved=false&session_token=`;
  const info = await getJson(page, infoUrl);

  const coord = info?.coordinate;
  if (typeof coord?.lat !== "number" || typeof coord?.lon !== "number") {
    logger.warn(`No coordinate in location info for "${query}"`, { id: entry.id, placeId });
    return null;
  }

  // Surfaced rather than enforced: a not-serviceable address still gets its
  // coordinate stored (Blinkit can start serving it later), but it's worth
  // knowing which rows can never report stock today.
  if (info?.is_serviceable === false) {
    logger.warn(`Address resolves but Blinkit reports it NOT serviceable`, { id: entry.id, query });
  }

  const resolvedPin = info?.location_info?.postal_code;
  if (resolvedPin && resolvedPin !== entry.pincode) {
    logger.warn(`Resolved a DIFFERENT pincode than configured - check this row`, {
      id: entry.id,
      configured: entry.pincode,
      resolved: resolvedPin,
    });
  }

  return { lat: coord.lat, lon: coord.lon };
}

async function main(): Promise<void> {
  const entries = await loadPincodeEntries();
  const pending = entries.filter((e) => e.quickCommerce && (e.lat === undefined || e.lon === undefined));

  if (pending.length === 0) {
    logger.info("Every quick-commerce row already has lat/lon - nothing to do");
    return;
  }

  logger.info(`Resolving lat/lon for ${pending.length} row(s)`);

  const browser = await chromium.launch({ headless: config.headless });
  let resolved = 0;
  try {
    const ctx = await browser.newContext({ userAgent: config.userAgent, locale: "en-IN" });
    const page = await ctx.newPage();
    await page.goto("https://blinkit.com/", {
      waitUntil: "domcontentloaded",
      timeout: config.requestTimeoutMs,
    });

    for (const entry of pending) {
      try {
        const coord = await resolveOne(page, entry);
        if (coord) {
          entry.lat = coord.lat;
          entry.lon = coord.lon;
          resolved++;
          logger.info(`Resolved "${entry.id}"`, coord);
        }
      } catch (err: any) {
        logger.error(`Failed to resolve "${entry.id}"`, { error: err.message });
      }
      // Deliberately unhurried - this is a one-off backfill against someone
      // else's geocoder, and there is no reason to burst it.
      await sleep(1_500);
    }
  } finally {
    await browser.close();
  }

  // Written once at the end so a mid-run failure can't leave a half-updated
  // file - savePincodeEntries itself writes temp-then-rename.
  await savePincodeEntries(entries);
  logger.info(`Done - resolved ${resolved}/${pending.length}, saved to data/pincodes.json`);
}

main().catch((err) => {
  logger.error("Fatal error resolving lat/lon", { error: err.message });
  process.exit(1);
});
