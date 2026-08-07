export type StockStatus = "IN_STOCK" | "COMING_SOON" | "OUT_OF_STOCK" | "UNKNOWN";

/**
 * "dom"         - load the page in Chromium and read a selector.
 * "api"         - plain axios call to a JSON endpoint (cheapest; preferred).
 * "browser-api" - JSON endpoint called via fetch() from INSIDE a real
 *                 Chromium page on the target's own origin.
 *
 * Why "browser-api" exists: Blinkit's availability endpoint is open (no auth,
 * no cookies) but sits behind Cloudflare bot management, which blocks on TLS
 * fingerprint rather than on headers. Live-verified 2026-08-07 from one
 * machine, same moment: curl -> 200, but Node axios, Node fetch/undici, AND
 * Playwright's own APIRequestContext all -> 403, across every combination of
 * browser-like headers (Accept-Language, Referer/Origin, sec-fetch-*,
 * sec-ch-ua, Accept-Encoding). Nothing sent at the header layer fixes it -
 * the Node TLS stack itself is what's rejected. Issuing the same fetch from
 * a loaded Chromium page passes, because it IS Chrome's TLS handshake, its
 * cookie jar and its origin.
 *
 * It's also the least detectable option available: one page load per origin
 * per cycle, then same-origin JSON calls that look exactly like the site's
 * own client - no headless UI automation, no location-picker driving, and
 * ~500ms per check instead of ~11s.
 */
export type CheckStrategy = "dom" | "api" | "browser-api";

/**
 * A UI step run before reading the stock selector - needed on quick-commerce
 * sites (Blinkit, Instamart, Zepto, ...) where availability isn't visible
 * until a delivery pincode/address is set via an on-page picker.
 */
export interface PreAction {
  action: "fill" | "click" | "press";
  selector: string;
  value?: string; // required for "fill" and "press" (e.g. "Enter")
  waitAfterMs?: number; // pause after the action, e.g. to let a dropdown/suggestion list settle
}

export interface CookieSeed {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

/**
 * A post-read sanity check for location-gated sites (dom strategy only).
 * Only consulted when a target would otherwise read IN_STOCK - if any
 * configured confirmation fails, that read is downgraded to UNKNOWN (no
 * alert) rather than trusted.
 *
 * Why this exists: on Zepto (and the same risk on any pincode-gated site),
 * the DEFAULT no-location view of an out-of-stock product shows the exact
 * same "Add to Cart" CTA as a genuinely in-stock, serviceable store. So any
 * time the location picker doesn't actually resolve a real Indian delivery
 * store - a slow re-render, a non-serviceable pincode, or (the big one) a
 * GitHub Actions runner hitting the site from a non-India datacenter IP -
 * the buy-box falls back to that default "Add to Cart" and the target
 * false-positives as "back in stock". These confirmations demand positive
 * proof that a real serviceable store resolved before an in-stock read is
 * believed. See the Zepto targets in targets.ts for the concrete signals.
 */
export interface InStockConfirmation {
  // Element whose text is inspected for this confirmation.
  selector: string;
  // If set, the guard passes only when the element's text matches this
  // (case-insensitive) regular expression - e.g. "\\d+\\s*min" to require a
  // delivery-ETA badge, which only appears once a serviceable store resolves.
  matches?: string;
  // If set, the guard fails when the element's text contains ANY of these
  // (case-insensitive substrings) - e.g. "select location", which means the
  // location picker was never actually applied.
  rejectAny?: string[];
}

/**
 * api strategy only: finds the ONE object describing a specific product
 * inside a JSON response, instead of pointing at a fixed dot-path.
 *
 * Why this exists: Blinkit's product endpoint returns a whole page layout,
 * and the SAME stock fields (`is_sold_out`, `inventory`) appear on ~90
 * objects in a single response - the real product, its sticky footer copy,
 * cart-action templates, analytics blobs, and every unrelated item in the
 * "you might also like" carousels. A dot-path like
 * `response.snippets.3.data` happens to hit the right one today, but the
 * index is just wherever that snippet landed in this render - exactly the
 * kind of positional guess that produced this file's earlier false alerts.
 * Matching on the product id instead is stable across layout changes.
 *
 * The matched object is flattened to `field=value;` pairs (in `select`
 * order) for the usual inStockValues/outOfStockValues substring matching.
 * The trailing `;` matters: it makes "inventory=0;" match a literal zero and
 * not the "inventory=0" prefix that a value like 100 would otherwise share.
 */
export interface JsonFind {
  // Field the candidate object must carry, e.g. "product_id".
  where: string;
  // Value that field must equal - compared as strings, so 779739 and
  // "779739" both match (the same response uses both forms).
  equals: string;
  // Fields read off the matched object, in output order. Every one must be
  // present, so a partial/template object (e.g. a cart-action stub that has
  // product_id and inventory but no is_sold_out) is skipped rather than
  // mistaken for the real product data.
  select: string[];
}

/**
 * The retailer a target belongs to. Every Target carries one, and
 * data/platforms.json holds an on/off switch per platform - flipping one off
 * (via `npm run admin`) drops all of its targets out of TARGETS before the
 * checker ever sees them. See src/platformStore.ts for the switch file and
 * the filter at the bottom of src/targets.ts for where it's applied.
 *
 * Adding a retailer means adding it here, in PLATFORMS (platformStore.ts),
 * and tagging its targets - the compiler enforces all three, so a new
 * retailer can't silently ship without a switch.
 */
export type Platform =
  | "amazon"
  | "blinkit"
  | "croma"
  | "flipkart"
  | "gamestheshop"
  | "reliancedigital";

/**
 * A single location to monitor. `url` is the page (dom strategy) or
 * JSON endpoint (api strategy) to hit for that specific location.
 */
export interface Target {
  id: string; // stable unique key, used for state tracking - never change once set
  // Which retailer this belongs to - drives the per-platform on/off switch in
  // data/platforms.json. Required so a new target can never miss the switch.
  platform: Platform;
  label: string; // human readable name shown in logs/notifications
  url: string;
  // Optional: the human-facing product page to link in notifications, for api
  // targets whose `url` is a raw JSON/inventory endpoint that would be useless
  // to click when racing to buy (e.g. Croma's OMS POST endpoint). Falls back
  // to `url` when unset.
  displayUrl?: string;
  strategy: CheckStrategy;
  // dom strategy: CSS selector whose text/attribute reveals stock state
  selector?: string;
  // api strategy: dot-path into the JSON response, e.g. "data.availability.status"
  jsonPath?: string;
  // api strategy, alternative to jsonPath: locate the product's own object by
  // id rather than by position. See JsonFind for why. Exactly one of
  // jsonPath/jsonFind must be set.
  jsonFind?: JsonFind;
  // api strategy only, optional: HTTP method (default GET). Some retailers'
  // real availability oracle is a POST (e.g. Croma's OMS delivery-promise
  // endpoint takes the product + pincode in a JSON body).
  method?: "GET" | "POST";
  // api strategy only, optional: extra request headers merged over the
  // defaults (so they can also override Accept etc). Needed for storefront
  // APIs that require an app token - note these are the PUBLIC tokens every
  // visitor's browser sends (embedded in the site's own frontend bundle),
  // not user secrets.
  requestHeaders?: Record<string, string>;
  // api strategy only, optional: JSON body sent with a POST request.
  requestBody?: unknown;
  // api strategy only, optional: dot-path whose value becomes the result
  // `detail` AND gets appended to notifications (opt-in - alerts stay
  // unchanged for targets that don't set this). Use when the response
  // carries context the human needs to judge an alert - e.g. Reliance
  // Digital's fulfilling store, since a mall-store-sourced offer can still
  // be rejected as phantom inventory at payment time.
  detailJsonPath?: string;
  // Optional label for the detailJsonPath line in notifications (defaults to
  // "Source"). Use when the extracted detail isn't a store/origin - e.g.
  // Games The Shop exposes a live unit count, where "Source: 5" would read
  // as nonsense but "Units in stock: 5" is exactly what a buyer racing a
  // restock wants to know.
  detailLabel?: string;
  // Values (case-insensitive substring match) that count as "in stock" for this target.
  inStockValues: string[];
  // Optional: values that count as "out of stock", checked BEFORE inStockValues.
  // Use this when the page reliably renders an explicit OOS marker (e.g. "Out Of
  // Stock", "Notify Me") but the "in stock" state is just the absence of that
  // marker rather than a distinct, reliably-present element - broad selectors
  // like "body" combined with a narrow, specific outOfStockValues signal are
  // less prone to waitForSelector timeouts and false positives from unrelated
  // "add to cart" text elsewhere on the page (recommendation carousels, etc).
  // If neither list matches, the target is reported OUT_OF_STOCK (safe default).
  outOfStockValues?: string[];
  // Optional: values that mean "listed but not yet orderable" (e.g. Blinkit's
  // "Coming soon" badge on pre-launch SKUs) - checked BEFORE outOfStockValues
  // and inStockValues, since it's a more specific signal than plain OOS and
  // worth its own notification so you know to go check the app by hand.
  comingSoonValues?: string[];
  // dom strategy only, optional: cookies set on the browser context before navigating -
  // use for sites that read delivery location/pincode from a cookie.
  cookies?: CookieSeed[];
  // dom strategy only, optional: UI steps run after page load and before reading
  // `selector` - use to type a pincode into a location picker and confirm it.
  preActions?: PreAction[];
  // dom strategy only, optional: extra checks that must all hold before a
  // would-be IN_STOCK read is trusted - otherwise it's downgraded to UNKNOWN.
  // See InStockConfirmation for the rationale (guards against false "back in
  // stock" alerts from the default/no-location view on pincode-gated sites).
  inStockConfirmations?: InStockConfirmation[];
}

export interface StockResult {
  target: Target;
  status: StockStatus;
  checkedAt: string; // ISO timestamp
  detail?: string; // raw matched text, for debugging
  error?: string;
  // Set post-check by detectPhantomStock (see phantomDetection.ts) when an
  // IN_STOCK read is suspected to be Reliance Digital's phantom store-stock
  // failure mode (a fulfilling store repeated across pincodes too far apart
  // to plausibly share a store) - downgrades the alert's framing without
  // changing `status` itself.
  phantomWarning?: string;
}

export interface StateEntry {
  status: StockStatus;
  lastCheckedAt: string;
  lastChangedAt: string;
}

export type StateMap = Record<string, StateEntry>;
