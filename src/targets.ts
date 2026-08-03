import { InStockConfirmation, Target } from "./types";
import { PincodeEntry, loadPincodeEntriesSync } from "./pincodeStore";

/**
 * Shared IN_STOCK guard for every Zepto target - see InStockConfirmation in
 * types.ts for the full rationale. In short: Zepto's default/no-location view
 * of an out-of-stock product shows the SAME "Add to Cart" CTA as a genuinely
 * in-stock serviceable store, so without these two positive checks the target
 * false-positives whenever the pincode doesn't truly resolve (slow re-render,
 * non-serviceable area, or - the common one - a GitHub Actions runner hitting
 * Zepto from a non-India datacenter IP). Both checks were live-verified
 * 2026-07-14 across an in-stock store (560066/Hagadur), an out-of-stock
 * serviceable store (147002/Patiala), and the default no-location view.
 */
const ZEPTO_IN_STOCK_CONFIRMATIONS: InStockConfirmation[] = [
  // 1. The location picker was actually applied: the header address stops
  //    reading the default "Select Location" prompt once a real address is set.
  { selector: "[data-testid='user-address']", rejectAny: ["select location"] },
  // 2. A serviceable dark store resolved: Zepto renders a delivery ETA
  //    ("N minutes") in the header for ANY serviceable location - in-stock or
  //    out-of-stock alike - but never on the unresolved/default view. Its
  //    presence is what separates a real per-pincode read from the default
  //    "Add to Cart" fallback that caused the false alerts.
  { selector: "header", matches: "\\d+\\s*min" },
];

/**
 * Builds the JSON body Croma's own PDP sends to its OMS delivery-promise
 * endpoint (POST api.croma.com/inventory/oms/v2/tms/details-pwa/). The real
 * page sends three promise lines (home delivery / store pickup / same-day);
 * a single HDEL home-delivery line was live-verified 2026-07-15 to answer
 * identically, and keeps the OOS signal unambiguous: with one line, ANY
 * `unavailableReason` in the response means not orderable, whereas the
 * 3-line body returns "SOURCING_RULE_NOT_DEFINED" noise on the pickup lines
 * even for in-stock items.
 *
 * Response shapes (both live-verified 2026-07-15):
 *   in stock  -> promise.suggestedOption.option.promiseLines.promiseLine has
 *                an entry with fulfillmentType "HDEL" + a delivery-date
 *                assignment for the requested zipCode (verified against an
 *                in-stock DualSense controller, itemID 312554)
 *   out of stock -> promiseLine is [] and an unavailableLine carries
 *                unavailableReason "NOT_ENOUGH_PRODUCT_CHOICES" (verified
 *                against both PS5 slim SKUs, which also render disabled
 *                Add to Cart buttons on the real PDP)
 */
function cromaPromiseBody(itemId: string, pincode: string): unknown {
  return {
    promise: {
      allocationRuleID: "SYSTEM",
      checkInventory: "Y",
      organizationCode: "CROMA",
      sourcingClassification: "EC",
      promiseLines: {
        promiseLine: [
          {
            fulfillmentType: "HDEL",
            mch: "",
            itemID: itemId,
            lineId: "1",
            categoryType: "nonMobile",
            reqEndDate: "2500-01-01",
            reqStartDate: "",
            requiredQty: "1",
            shipToAddress: {
              company: "",
              country: "",
              city: "",
              mobilePhone: "",
              state: "",
              zipCode: pincode,
              extn: { irlAddressLine1: "", irlAddressLine2: "" },
            },
            extn: { widerStoreFlag: "N" },
          },
        ],
      },
    },
  };
}

/**
 * The public subscription key Croma's frontend bundle ships to every
 * visitor for its OMS inventory API - NOT a user secret. If Croma rotates
 * it, grab the new one from DevTools -> Network -> the details-pwa request's
 * `oms-apim-subscription-key` header on any product page.
 */
const CROMA_OMS_SUBSCRIPTION_KEY = "1131858141634e2abe2efb2b3a2a2a5d";

/** Builds one Croma target - see cromaPromiseBody for the verified signal. */
function cromaTarget(opts: { idSuffix: string; label: string; itemId: string; productUrl: string }): Target {
  return {
    id: `croma-${opts.idSuffix}`,
    label: `Croma - ${opts.label}`,
    url: "https://api.croma.com/inventory/oms/v2/tms/details-pwa/",
    displayUrl: opts.productUrl,
    strategy: "api",
    method: "POST",
    requestHeaders: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "oms-apim-subscription-key": CROMA_OMS_SUBSCRIPTION_KEY,
      Referer: "https://www.croma.com/",
      Origin: "https://www.croma.com",
    },
    // Delivery inventory is effectively national: live-tested 5 zips across
    // Bangalore/Cuttack/Patiala/Navi Mumbai/Delhi on an in-stock item - all
    // serviceable, only the promised delivery date differed. One
    // representative pincode therefore covers "orderable at all".
    requestBody: cromaPromiseBody(opts.itemId, "560075"),
    // suggestedOption contains BOTH the promiseLines (filled when orderable)
    // and any unavailableLines - so an explicit unavailableReason is checked
    // first, and the HDEL promise entry is the positive signal. With the
    // single-line body these are mutually exclusive.
    jsonPath: "promise.suggestedOption",
    outOfStockValues: ["unavailablereason"],
    inStockValues: ["fulfillmenttype"],
    // NOT wired as a comingSoonValues check (deliberately) - investigated
    // 2026-07-16: every in-stock item's promiseLine carries an
    // `extn.preOrderItem` string field (undocumented until now), which
    // reads as the obvious "this is a pre-order, not real stock" signal.
    // But across ~20 live products sampled (Galaxy Z Fold7/Flip7, Vivo
    // X Fold5, tablets, the 3 PS5 SKUs) it was ALWAYS the empty string - no
    // currently-active pre-order product exists on croma.com to observe a
    // populated value against, so the real non-empty shape is unknown. Per
    // this file's own rule (never wire a match against a guessed value -
    // see the Reliance Digital `sellable` false-positive above), this stays
    // a documented dormant field, not an active check. If Croma ever runs a
    // PS5 pre-order window, re-probe `extn.preOrderItem` live first to see
    // what it actually contains before wiring a comingSoonValues match.
  };
}

/**
 * The public Bearer token Reliance Digital's frontend (Fynd platform) ships
 * to every visitor - base64 of its application id:token pair, NOT a user
 * secret. If it rotates, grab the new one from DevTools -> Network -> any
 * /api/service/application/... request's `authorization` header.
 */
const RELIANCE_DIGITAL_BEARER = "Bearer NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==";

/**
 * Builds one per-pincode Reliance Digital target - availability via Fynd's
 * article/price endpoint, the same one the PDP buy-box is driven by.
 *
 * FALSE-POSITIVE FOUND AND FIXED 2026-07-15 (same day as the original
 * wiring): the first version of these targets read the catalog sizes
 * endpoint's `sellable` flag, which fired a real alert while the user's own
 * PDP view showed nothing purchasable. Root cause: `sellable` (and the
 * PDP's own JSON-LD "InStock" markup) is a NATIONAL catalog flag meaning
 * "some RD store somewhere holds this article" - it is not deliverability.
 * The page's real buy-box signal is this per-pincode endpoint:
 *
 *   GET /catalog/v2.0/products/<slug>/sizes/OS/price/?pincode=<pin>
 *     deliverable    -> full seller offer: article_id, live quantity, price,
 *                       and the fulfilling store's long_lat
 *     not deliverable -> HTTP 200 with a bare `{}` (no inner key exists at
 *                       all, hence jsonPath "$" + whole-body matching)
 *
 * Live-verified 2026-07-15 across the priority cities: Bangalore 560075 got
 * a qty-4 offer from a Bangalore store while Patiala/Cuttack/Lucknow got
 * `{}` for the same SKU at the same moment - i.e. RD fulfills consoles from
 * regional store inventory, NOT one national pool. That's why these fan out
 * per city like the quick-commerce targets (one representative pincode per
 * city - nearby pincodes resolve to the same store).
 *
 * KNOWN LIMIT - PHANTOM STORE STOCK (live case 2026-07-15, same day): a
 * qty-4 offer fulfilled from the "Mantri Bangalore" retail store passed
 * EVERY anonymous layer - this endpoint, and even a real cart-add with RD's
 * own auto-allocator ({out_of_stock:false, deliverable:true, is_valid:true})
 * - yet the actual payment step rejected it with "article not available".
 * The order-time allocation check lives behind the login wall and is not
 * reachable anonymously, and no field visible out here distinguishes such
 * offers from genuine ones (tat/distance/delivery_promise are null for ALL
 * products, orderable bestsellers included; the quantity being frozen at 4
 * all day was the only tell). Mitigation: detailJsonPath "store" puts the
 * fulfilling store's name + count into the alert itself, so the reader can
 * treat a mall-store source with suspicion but still race for warehouse-
 * looking sources. Treat an RD alert as "offer visible for your pincode -
 * go try NOW, but payment may still fail", not a purchase guarantee.
 */
function relianceDigitalTarget(opts: {
  idSuffix: string;
  label: string;
  slug: string;
  pincode: string;
  city: string;
}): Target {
  return {
    id: `reliancedigital-${opts.idSuffix}-${opts.pincode}`,
    label: `Reliance Digital - ${opts.city} ${opts.pincode} (${opts.label})`,
    url: `https://www.reliancedigital.in/api/service/application/catalog/v2.0/products/${opts.slug}/sizes/OS/price/?pincode=${opts.pincode}`,
    displayUrl: `https://www.reliancedigital.in/product/${opts.slug}`,
    strategy: "api",
    requestHeaders: {
      Accept: "application/json, text/plain, */*",
      authorization: RELIANCE_DIGITAL_BEARER,
      "x-currency-code": "INR",
    },
    // Whole-body match (see resolveJsonPath): a deliverable offer always
    // carries `article_id`; the not-deliverable body is `{}` and matches
    // nothing, falling through to the safe OUT_OF_STOCK default.
    jsonPath: "$",
    inStockValues: ["article_id"],
    // Surfaces the fulfilling store ({uid, name, count}) in the alert - the
    // reader's only defense against phantom retail-store stock, see the
    // KNOWN LIMIT note above.
    detailJsonPath: "store",
  };
}

/**
 * Builds one Reliance Digital pre-order watch target - a SEPARATE endpoint
 * from relianceDigitalTarget above, added 2026-07-16 while investigating
 * whether RD exposes any "upcoming stock" signal. re-verified live that
 * tat/distance/delivery_promise (mentioned in the KNOWN LIMIT note above)
 * are still null/absent, but found the REAL catalog product-detail endpoint
 * is v1.0, not v2.0 (v2.0 404s) - and that v1.0 body carries a full,
 * genuine pre-order schema under `_custom_json`:
 *
 *   GET /catalog/v1.0/products/<slug>/
 *     _custom_json.pre_order_enabled -> boolean
 *     _custom_json.pre_order_launch_date / _start_date / _end_date / etc.
 *
 * Live-verified 2026-07-16: `pre_order_enabled: false` (and every date field
 * null) for all 3 tracked PS5 SKUs - dormant today, but a real, currently
 * live field RD's own Fynd platform uses elsewhere for genuine pre-order
 * campaigns (e.g. new phone launches). This is a per-SKU product attribute,
 * NOT pincode-dependent (unlike deliverability), so ONE target per SKU is
 * enough - no need to fan this out across RELIANCE_DIGITAL_PINCODES like
 * relianceDigitalTarget above.
 *
 * inStockValues is deliberately empty: this target exists ONLY to watch for
 * a pre-order window opening, not to duplicate the per-pincode
 * deliverability check above - so it can only ever read COMING_SOON or
 * (by default) OUT_OF_STOCK, never a false "back in stock" alert.
 */
function relianceDigitalPreOrderTarget(opts: { idSuffix: string; label: string; slug: string }): Target {
  return {
    id: `reliancedigital-preorder-${opts.idSuffix}`,
    label: `Reliance Digital - ${opts.label} (pre-order watch)`,
    url: `https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/${opts.slug}/`,
    displayUrl: `https://www.reliancedigital.in/product/${opts.slug}`,
    strategy: "api",
    requestHeaders: {
      Accept: "application/json, text/plain, */*",
      authorization: RELIANCE_DIGITAL_BEARER,
      "x-currency-code": "INR",
    },
    jsonPath: "_custom_json",
    comingSoonValues: ['"pre_order_enabled":true'],
    inStockValues: [],
  };
}

/**
 * Builds one Games The Shop target - the online store of India's
 * PlayStation-exclusive retail chain (run by E-xpress Interactive, Sony's
 * official PlayStation distributor in India), investigated 2026-07-15 when
 * the user asked about "PS exclusive stores".
 *
 * The site is a custom Next.js storefront backed by an open JSON API at
 * green-api.gamestheshop.com - live-verified 2026-07-15 to answer a
 * completely bare GET (no cookies, no token, not even an Origin header):
 *
 *   GET /storefront/products/<product_id>
 *     data.stock_status    -> "In Stock" | "Out of Stock" (product level)
 *     data.total_inventory -> live unit count (e.g. 5), 0 when out of stock
 *
 * Verified both ways the same day: both PS5 Slim consoles read
 * "Out of Stock"/0 while an in-stock accessory (Logitech G29, itemID
 * d5715b3a-...) read "In Stock"/5 at the same moment. Like Sony Center this
 * is one national online inventory pool (their physical stores don't expose
 * per-store stock online), so a single location-independent target per SKU
 * is the correct shape. detailJsonPath surfaces the live unit count in the
 * alert so the reader knows how hard to race (5 units left vs 100).
 *
 * PRE-ORDER DETECTION, added 2026-07-16: GTS has a genuine `is_pre_order`
 * boolean (paired with a `release_date`), live-verified against real
 * upcoming-game listings ("The Blood of Dawnwalker", "Marvel Tokon:
 * Fighting Souls" - both `is_pre_order: true` with a future release_date).
 * Critically, GTS reports `stock_status: "In Stock"` for those pre-order
 * items too - identical to genuine ready-to-ship stock - so `stock_status`
 * ALONE cannot tell "buy it now" apart from "pay now, ships on launch day".
 * jsonPath is therefore the whole `data` object (not just `stock_status`),
 * with `comingSoonValues` matching `is_pre_order:true` and checked first
 * (see resolveStatus in scraper.ts) so a future pre-order PS5 SKU routes to
 * COMING_SOON instead of firing a misleading "IN STOCK, buy now" alert.
 * Currently dormant for both tracked SKUs (`is_pre_order: false`, an old
 * `release_date` in the past) - only matters if GTS pre-lists a new PS5 SKU.
 *
 * SONY PHYSICAL STORES - INVESTIGATED, NOT POSSIBLE (2026-07-15): the user
 * asked whether the ~100 Sony Center / Sony Exclusive stores across India
 * can be stock-checked. Findings, so nobody re-does this dead end:
 *   - shopatsc.com (Sony Center online, already a target above) has NO
 *     in-store pickup: Shopify's per-location pickup-availability endpoint
 *     (/variants/<id>/?section_id=pickup-availability) returns 404, so
 *     Shopify never exposes per-store inventory for it.
 *   - The "Find Store" page is driven by POST
 *     shopatsonycenter.com/api/get-sony-center - live-called: it returns a
 *     directory of 113 franchise stores (101 "Sony Center" + 12 "Sony
 *     Exclusive": name/address/phone/email/lat-long/timings) with ZERO
 *     inventory fields. It's a phonebook, not a stock system - useful only
 *     for finding a store to CALL when an online alert fires.
 *   - No PlayStation-branded store chain with online per-store stock exists
 *     in India; Games The Shop (below) is the closest thing - the official
 *     distributor's own PS-focused chain - and only its ONLINE stock is
 *     visible.
 */
function gamesTheShopTarget(opts: { idSuffix: string; label: string; productId: string }): Target {
  return {
    id: `gamestheshop-${opts.idSuffix}`,
    label: `Games The Shop - ${opts.label}`,
    url: `https://green-api.gamestheshop.com/storefront/products/${opts.productId}`,
    displayUrl: `https://www.gamestheshop.com/product/${opts.productId}`,
    strategy: "api",
    requestHeaders: { Accept: "application/json" },
    // Whole "data" object, not just "data.stock_status" - see the pre-order
    // note in the factory doc comment above for why is_pre_order must be
    // checked too.
    jsonPath: "data",
    comingSoonValues: ['"is_pre_order":true'],
    // "Out of Stock" is checked before inStockValues, so the substring
    // overlap with "In Stock" is safe (same pattern as every target here).
    outOfStockValues: ["out of stock"],
    inStockValues: ["in stock"],
    // Live unit count in the alert - see the factory doc comment.
    detailJsonPath: "data.total_inventory",
    detailLabel: "Units in stock",
  };
}

/**
 * Every pincode/address this file tracks now lives in data/pincodes.json,
 * managed via `npm run admin` (browser UI) instead of editing this file -
 * see src/pincodeStore.ts for the schema. Each row's `quickCommerce`/
 * `relianceDigital` flags pick which of the two generators below it feeds:
 * the Reliance Digital list was historically a smaller curated set (one
 * representative pincode per city - nearby pincodes resolve to the same
 * regional store, so checking all of them would just repeat the same answer
 * 3x per SKU), while quick-commerce (Blinkit/Zepto/Instamart) fans out to
 * every pincode since each dark-store zone can genuinely differ.
 */
const PINCODE_ENTRIES = loadPincodeEntriesSync();

/**
 * The 3 Reliance Digital targets (per SKU) for one pincode entry - see the
 * relianceDigitalTarget factory above for the verified per-pincode contract.
 */
function relianceDigitalPincodeTargets(entry: PincodeEntry): Target[] {
  const { pincode, city } = entry;
  return [
    relianceDigitalTarget({
      idSuffix: "ps5-slim",
      label: "PS5 Slim Console (Disc)",
      slug: "sony-playstation-ps5-slim-console-luh1rv-7537998",
      pincode,
      city,
    }),
    relianceDigitalTarget({
      idSuffix: "ps5-slim-digital",
      label: "PS5 Slim Digital Console",
      slug: "sony-playstation-ps5-slim-digital-console-luh1rv-7537999",
      pincode,
      city,
    }),
    relianceDigitalTarget({
      idSuffix: "ps5-digital-edition",
      label: "PS5 Digital Edition Console",
      slug: "sony-playstation-5-digital-edition-console",
      pincode,
      city,
    }),
  ];
}

/**
 * The 5 quick-commerce targets (Blinkit x2 SKUs, Instamart placeholder,
 * Zepto x2 SKUs) for one pincode entry. Uses `entry.searchText` instead of
 * the bare pincode when set - needed because a bare-pincode search on
 * Zepto/Blinkit can resolve ambiguously to more than one dark-store zone
 * (live-verified case: pincode 560067/Kadugodi returned multiple distinct
 * locality suggestions serving different stores) - a fuller address string
 * makes the first suggestion clicked deterministically the right store.
 * `entry.id` (not the bare pincode) is the id suffix so rows with a custom
 * address get their own distinct target ids alongside a plain-pincode row
 * for the same pincode.
 */
function quickCommercePincodeTargets(entry: PincodeEntry): Target[] {
  const { id, pincode, city } = entry;
  const locationValue = entry.searchText || pincode;

  return [
    {
      // Blinkit's location picker is VERIFIED WORKING (see original
      // 2026-07-08 live test on pincode 110001) - typing a pincode into the
      // "Change Location" modal returns real suggestions, and clicking one
      // actually updates the delivery address and re-renders availability.
      id: `blinkit-ps5-${id}`,
      label: `Blinkit - ${city} ${pincode}`,
      url: "https://blinkit.com/prn/playstation-5-digital-edition-gaming-console-white/prid/779739",
      strategy: "dom",
      preActions: [
        // Opens the "Change Location" modal from the header.
        { action: "click", selector: "div[class*='LocationBar__Subtitle']" },
        { action: "fill", selector: "input[name='select-locality']", value: locationValue, waitAfterMs: 2000 },
        // Clicks the first suggestion in the results list.
        { action: "click", selector: "div[class*='LocationSearchList__LocationListContainer']", waitAfterMs: 3000 },
      ],
      // Scoped to the product's own info panel (breadcrumb/title/price/stock),
      // NOT the whole page - this product page also renders "Top 10 products
      // in this category" and "People also bought" carousels full of OTHER
      // products' "ADD" buttons, so a page-wide selector would false-positive
      // on those. `ProductWrapperRightSection` is a styled-components class
      // that wraps only the real product's info column.
      selector: "div[class*='ProductWrapperRightSection']",
      // Confirmed live 2026-07-12 (Bhubaneswar 751012, PS5 Digital Edition):
      // Blinkit pre-lists some SKUs as orderable-later with this exact badge.
      comingSoonValues: ["coming soon"],
      outOfStockValues: ["out of stock"],
      inStockValues: ["add"],
    },
    {
      // Added 2026-07-29 - newer console revision (CFI-2116A01Y, Standard
      // Edition), different product/prid from the entry above (added
      // alongside it, not replacing it, so both listings stay tracked).
      // Same location-picker flow and selectors - Blinkit's per-product page
      // layout is consistent across SKUs.
      id: `blinkit-ps5-cfi-2116a01y-${id}`,
      label: `Blinkit - ${city} ${pincode} (CFI-2116A01Y Standard Edition)`,
      url: "https://blinkit.com/prn/playstation-cfi-2116a01y-5-gaming-console-standard-edition-e-chassis-white/prid/763266",
      strategy: "dom",
      preActions: [
        { action: "click", selector: "div[class*='LocationBar__Subtitle']" },
        { action: "fill", selector: "input[name='select-locality']", value: locationValue, waitAfterMs: 2000 },
        { action: "click", selector: "div[class*='LocationSearchList__LocationListContainer']", waitAfterMs: 3000 },
      ],
      selector: "div[class*='ProductWrapperRightSection']",
      comingSoonValues: ["coming soon"],
      outOfStockValues: ["out of stock"],
      inStockValues: ["add"],
    },
    {
      // PLACEHOLDER preActions - CONFIRMED NOT TO WORK, live-tested
      // 2026-07-08 against this exact product URL. Findings:
      //   - The real product page has NO location/pincode picker element at
      //     all - dumped every data-testid on the page (30 of them) and the
      //     full header HTML; nothing resembling `address-selector` exists.
      //     Stock appears to resolve server-side (IP-based), the same
      //     caveat that applies to Amazon/Flipkart above.
      //   - Swiggy's Instamart homepage (the only place with a real address
      //     search flow) is bot-blocked outright in headless mode:
      //     "Request Blocked - Your request looks automated".
      // Net effect: every entry generated from this factory will click/fill
      // against selectors that don't exist, silently no-op, and all of them
      // will report the SAME (server-inferred) status regardless of pincode -
      // this does NOT actually check per-city availability yet. `selector`
      // below IS confirmed real (data-testid="sold-out" is genuinely present
      // on the page today), so the OUT_OF_STOCK reading itself is
      // trustworthy - just not the per-pincode part.
      id: `instamart-ps5-${id}`,
      label: `Swiggy Instamart - ${city} ${pincode} (location NOT verified - see comment)`,
      url: "https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR",
      strategy: "dom",
      preActions: [
        { action: "click", selector: "[data-testid='address-selector']" },
        {
          action: "fill",
          selector: "input[placeholder='Search for area, street name...']",
          value: locationValue,
          waitAfterMs: 1200,
        },
        { action: "click", selector: "[data-testid='address-search-result-0']", waitAfterMs: 1500 },
      ],
      selector: "[data-testid='sold-out']",
      outOfStockValues: ["sold out"],
      inStockValues: ["add"],
    },
    {
      // VERIFIED live 2026-07-08 against the real product page below.
      // Zepto's location picker DOES respond to headless automation, same
      // as Blinkit's: opening the address modal via `user-address`, filling
      // the search box, and clicking the first `address-search-item` result
      // actually updates delivery location and re-renders availability -
      // confirmed live by pincode 147002 flipping the CTA from
      // "Add to Cart" to "Notify Me when back in stock".
      //
      // FALSE-POSITIVE FOUND AND FIXED 2026-07-08: a live run reported
      // IN_STOCK for Gurugram/Bhubaneswar/Dehradun that had already reverted
      // to OUT_OF_STOCK by the time it was checked manually. Root-caused by
      // polling the buy-box every 300ms after clicking the address
      // suggestion: the DOM keeps showing the STALE "Add to Cart" text from
      // the default/no-pincode view for ~2.2s before Zepto actually
      // re-fetches and re-renders availability for the new address. The
      // previous 3500ms waitAfterMs had thin margin over that and could
      // read mid-transition on a slower connection (e.g. a GitHub Actions
      // runner). Bumped to 7000ms (~3x the observed transition time) below.
      id: `zepto-ps5-${id}`,
      label: `Zepto - ${city} ${pincode}`,
      url: "https://www.zepto.com/pn/playstation-5-console-standard/pvid/ad968d7d-c5d8-415e-b7d4-58f84ff13076",
      strategy: "dom",
      preActions: [
        // Opens the "Select Location" modal from the header.
        { action: "click", selector: "[data-testid='user-address']" },
        { action: "fill", selector: "[data-testid='address-search-input'] input", value: locationValue, waitAfterMs: 2000 },
        // Clicks the first suggestion in the results list. waitAfterMs is
        // intentionally generous - see the false-positive note above.
        { action: "click", selector: "[data-testid='address-search-item']", waitAfterMs: 7000 },
      ],
      // Scoped to the buy-box only (title/price/CTA) - confirmed NOT to
      // include the page's global nav/footer, which also lists city names
      // like "Patiala" and "Gurugram" that would otherwise false-positive
      // on naive text matching. Like Flipkart's obfuscated classes, this is
      // a hashed CSS-module class name that may rotate on Zepto redeploys -
      // re-verify if this target starts erroring out.
      selector: ".KQfnF.ckhcV",
      outOfStockValues: ["notify me", "out of stock"],
      inStockValues: ["add to cart"],
      inStockConfirmations: ZEPTO_IN_STOCK_CONFIRMATIONS,
    },
    {
      // Same product family/site behavior as the entry above (standard
      // edition) - selectors, location-picker flow, and the 7000ms
      // false-positive-avoidance wait are identical, just a different
      // product page. Confirmed live 2026-07-08 that this page uses the
      // same buy-box class and correctly flips to "Notify Me when back in
      // stock" once a pincode is applied.
      id: `zepto-ps5-digital-${id}`,
      label: `Zepto - ${city} ${pincode} (Digital Edition)`,
      url: "https://www.zepto.com/pn/playstation-5-console-digital/pvid/4dd0b8da-d86d-4d40-8ab9-8413ebeec4df",
      strategy: "dom",
      preActions: [
        { action: "click", selector: "[data-testid='user-address']" },
        { action: "fill", selector: "[data-testid='address-search-input'] input", value: locationValue, waitAfterMs: 2000 },
        { action: "click", selector: "[data-testid='address-search-item']", waitAfterMs: 7000 },
      ],
      selector: ".KQfnF.ckhcV",
      outOfStockValues: ["notify me", "out of stock"],
      inStockValues: ["add to cart"],
      inStockConfirmations: ZEPTO_IN_STOCK_CONFIRMATIONS,
    },
  ];
}

/**
 * --- Findings from live testing against each site while building this ---
 *
 * None of India's major PS5 retailers expose a "list stores in city X with
 * live stock" API - they all sell from one national inventory pool, and
 * "location" only affects delivery estimate/serviceability, not whether the
 * item is purchasable. So per-city targets for Cuttack/Bhubaneswar/Patiala/
 * Chandigarh/Dehradun/Delhi/Gurugram/Hyderabad/Lucknow/Bangalore/Mumbai/Pune
 * don't map onto anything real here - what actually matters is "is it in
 * stock at all, nationally," which is what every target below checks.
 *
 * Sony Center (shopatsc.com) - CONFIRMED WORKING, high confidence. Sony's own
 *   official-branded retail chain in India runs on Shopify, which exposes a
 *   public, stable JSON endpoint per product: `/products/<handle>.js`. Live
 *   test returned a clean `available: true/false` boolean for both PS5 SKUs
 *   (both currently false, i.e. out of stock, at time of writing). No DOM
 *   scraping, no bot-detection risk, no fragile UI flow - this is the most
 *   reliable target in this file. Sony doesn't sell PS5 hardware through its
 *   own sony.co.in store in India, only through retail partners like this.
 *
 * Amazon.in - CONFIRMED SELECTOR, medium confidence.
 *   `#availability` reliably showed "Currently unavailable." live. Amazon's
 *   location-change modal (`#nav-global-location-popover-link` ->
 *   `#GLUXZipUpdateInput` -> `#GLUXZipUpdate`) would not actually apply a new
 *   pincode under headless Playwright in testing - its bot detection appears
 *   to specifically obstruct that interactive flow.
 *
 * Flipkart - CONFIRMED WORKING via structured data, high confidence for
 *   "is this in stock anywhere," NOT for "is this deliverable to me."
 *   The visible page uses auto-generated/rotating CSS class names (e.g.
 *   `css-146c3p1`) with no stable selector to grab - but every product page
 *   also embeds a `<script type="application/ld+json" id="jsonLD">` block
 *   (schema.org Product markup, kept stable on purpose for Google
 *   Shopping/SEO) containing `offers.availability`: "https://schema.org/
 *   InStock" or ".../OutOfStock". Confirmed live, present in the raw
 *   server-rendered HTML with no JS execution needed - sidesteps the
 *   obfuscated-class problem by reading a data contract Flipkart has an
 *   external incentive to keep stable. HOWEVER this field reflects whether
 *   ANY seller has stock, not whether a seller can deliver to any specific
 *   address - confirmed live when a real alert fired for "InStock" while
 *   the page separately showed no seller servicing the user's actual
 *   pincode. Flipkart's real delivery-location picker (like Amazon's) does
 *   not respond to headless automation - typing a pincode triggers no
 *   suggestions and no network call at all, and there's no location cookie
 *   to set directly as a shortcut either.
 *
 * IMPORTANT for Amazon and Flipkart specifically: neither exposes a
 * scriptable way to check a chosen city/pincode - both default to whatever
 * location their server resolves from the request's IP address. That means
 * accuracy for "is this available near me" depends entirely on WHERE this
 * script's network connection actually is:
 *   - Run it from your own home connection in the city you care about -
 *     the default location will genuinely reflect your area.
 *   - Do NOT rely on the included GitHub Actions workflow
 *     (.github/workflows/stock-check.yml) for these two targets - GitHub's
 *     hosted runners execute from their own cloud datacenters (not India),
 *     so the resolved location would be arbitrary, not yours. Sony Center
 *     is unaffected by this (it's a national sale, not location-gated) and
 *     is fine to run from GitHub Actions.
 *
 * Croma and Reliance Digital - PREVIOUSLY EXCLUDED, NOW WORKING via their
 * internal storefront APIs (re-investigated and live-verified 2026-07-15,
 * after both had stock the previous day that this checker missed):
 *   - Croma: the website itself is still hard-blocked for automation - the
 *     Akamai edge 403s every plain page load (curl, axios, AND headless
 *     Chromium/real-Chrome; only a HEADFUL real Chrome passes, and cookies
 *     minted there do NOT transfer back to headless). But the availability
 *     oracle the PDP itself uses - POST api.croma.com/inventory/oms/v2/tms/
 *     details-pwa/ - accepts plain axios calls with NO cookies at all, just
 *     the public `oms-apim-subscription-key` header every visitor's browser
 *     sends. See the Croma targets below for the verified in/out-of-stock
 *     response shapes.
 *   - Reliance Digital: runs on the Fynd commerce platform. Auth is a
 *     static public Bearer token from the frontend bundle; the x-fp-
 *     signature request-signing header the site also sends is NOT enforced
 *     server-side (verified live). The old dom-strategy blockers (unreachable
 *     "Apply" control - it's a <p>, not a button - and the empty Vue
 *     placeholder buy-box) are moot since the API needs no page at all.
 *     CAUTION: the catalog sizes endpoint's `sellable` flag is a NATIONAL
 *     "exists in some store" flag and fired a live false alert - the real
 *     per-pincode deliverability signal is the v2.0 article/price endpoint;
 *     see the relianceDigitalTarget factory for the full post-mortem.
 *
 * Excluded after live testing - not shipped, to avoid pretending confidence
 * that testing disproved:
 *   - Vijay Sales: has a real "Out Of Stock"/"Notify Me" vs "Add to Cart"
 *     signal, but the page interleaves multiple product cards (this item +
 *     a "related products" carousel) using the SAME classes - `.first()` on
 *     either selector returned contradictory results in testing, picking up
 *     an unrelated carousel item rather than the main product reliably.
 */
export const TARGETS: Target[] = [
  {
    id: "sonycenter-ps5-standard",
    label: "Sony Center - PS5 Standard Edition",
    url: "https://shopatsc.com/products/playstation-5-standard-edition.js",
    strategy: "api",
    jsonPath: "available",
    inStockValues: ["true"],
  },
  {
    id: "sonycenter-ps5-digital",
    label: "Sony Center - PS5 Digital Edition",
    url: "https://shopatsc.com/products/playstation-5-digital-edition.js",
    strategy: "api",
    jsonPath: "available",
    inStockValues: ["true"],
  },

  // --- Games The Shop, added 2026-07-15 - the PlayStation-exclusive retail
  // chain run by Sony's official Indian distributor. National online stock
  // via an open JSON API; see the gamesTheShopTarget factory above for the
  // verified contract and for why the physical Sony Center stores the user
  // asked about can NOT be stock-checked (directory API only, no inventory).
  // Both SKUs read "Out of Stock"/0 units at wiring time. ------------------
  gamesTheShopTarget({
    idSuffix: "ps5-slim-disc",
    label: "PS5 Slim Console - Disc Edition",
    productId: "1fe01712-6e2b-49b0-9f93-f9670b4ec2a8",
  }),
  gamesTheShopTarget({
    idSuffix: "ps5-slim-digital",
    label: "PS5 Slim Console - Digital Edition",
    productId: "0a3c6810-ed3d-4bec-8e98-48a2ed5208fd",
  }),
  {
    id: "amazon-national",
    // IMPORTANT: "national" here means "wherever this script's network
    // connection resolves to," not a chosen city - see the IMPORTANT note
    // above this array for why that matters and how to run it correctly.
    label: "Amazon.in - PS5 console (location = wherever this script runs from)",
    url: "https://www.amazon.in/Sony-CFI-1008A01R-PlayStation-5-console/dp/B08FV5GC28",
    strategy: "dom",
    selector: "#availability",
    // Live-verified 2026-07-16 against a real active pre-order listing (GTA
    // VI, same #availability selector): a not-yet-released item reads
    // "This item will be released on <date>.\nPre-order now." - same
    // selector already scraped here, so this is free to check even though
    // it's dormant for the PS5 console itself (already released since 2021,
    // so #availability will essentially never say this for THIS listing -
    // only useful if Amazon lists a new not-yet-released PS5 SKU/bundle).
    comingSoonValues: ["will be released on", "pre-order now"],
    outOfStockValues: ["currently unavailable", "out of stock"],
    inStockValues: ["in stock", "few left", "hurry"],
  },
  {
    id: "flipkart-national",
    label: "Flipkart - PS5 console (location = wherever this script runs from)",
    url: "https://www.flipkart.com/sony-playstation5-console-slim-cfi-2008a01x-1024-gb/p/itm89489e2adcd2c",
    strategy: "dom",
    selector: "script#jsonLD",
    outOfStockValues: ["schema.org/outofstock"],
    inStockValues: ["schema.org/instock"],
  },
  {
    // Added 2026-07-27 - newer console revision (CFI-2116A01Y) bundled with
    // Astro's Playroom, different listing/pid from flipkart-national above.
    // Same jsonLD-based strategy and same location caveat applies.
    id: "flipkart-ps5-cfi-2116-astros-playroom",
    label: "Flipkart - PS5 Console CFI-2116A01Y w/ Astro's Playroom (location = wherever this script runs from)",
    url: "https://www.flipkart.com/sony-ps5-console-cfi-2116a01y-1024-gb-astros-playroom/p/itmd38e3aba0e54b?pid=GMCHPBNJAP2BPAXK",
    strategy: "dom",
    selector: "script#jsonLD",
    outOfStockValues: ["schema.org/outofstock"],
    inStockValues: ["schema.org/instock"],
  },

  // --- Reliance Digital, added 2026-07-15 after a missed restock the
  // previous day; reworked to per-pincode targets the SAME day after the
  // original national `sellable` check fired a false alert - see the
  // relianceDigitalTarget factory above for the root cause and the verified
  // per-pincode contract. At rework time: Bangalore 560075 read a live
  // qty-4 offer (genuinely orderable) while Patiala/Cuttack/Lucknow read
  // `{}` (not deliverable) for the same SKUs at the same moment. Pincodes are
  // sourced from data/pincodes.json (relianceDigital: true rows) - see the
  // relianceDigitalPincodeTargets factory above. ---------------------------
  ...PINCODE_ENTRIES.filter((e) => e.relianceDigital).flatMap(relianceDigitalPincodeTargets),

  // --- Reliance Digital pre-order watch, added 2026-07-16 - see the
  // relianceDigitalPreOrderTarget factory above for the verified
  // `_custom_json.pre_order_enabled` contract. One target per SKU (not
  // fanned out per pincode - pre-order eligibility isn't pincode-dependent).
  // All 3 read `pre_order_enabled: false` at wiring time. -------------------
  relianceDigitalPreOrderTarget({
    idSuffix: "ps5-slim",
    label: "PS5 Slim Console (Disc)",
    slug: "sony-playstation-ps5-slim-console-luh1rv-7537998",
  }),
  relianceDigitalPreOrderTarget({
    idSuffix: "ps5-slim-digital",
    label: "PS5 Slim Digital Console",
    slug: "sony-playstation-ps5-slim-digital-console-luh1rv-7537999",
  }),
  relianceDigitalPreOrderTarget({
    idSuffix: "ps5-digital-edition",
    label: "PS5 Digital Edition Console",
    slug: "sony-playstation-5-digital-edition-console",
  }),

  // --- Croma, added 2026-07-15 alongside Reliance Digital - "api" strategy
  // POST against the OMS delivery-promise endpoint the PDP itself uses, see
  // cromaPromiseBody/cromaTarget above for the verified request/response
  // contract. The website stays Akamai-blocked for automation; this endpoint
  // is the one path that answers without cookies. At wiring time all three
  // SKUs read OUT_OF_STOCK (NOT_ENOUGH_PRODUCT_CHOICES + disabled Add to
  // Cart buttons on the real PDP, cross-checked headful). ------------------
  cromaTarget({
    idSuffix: "ps5-slim-disc-321320",
    label: "PS5 Slim 1TB Standard Disc",
    itemId: "321320",
    productUrl: "https://www.croma.com/sony-playstation-5-1tb-ssd-standard-disc-gaming-console-white-/p/321320",
  }),
  cromaTarget({
    idSuffix: "ps5-slim-digital-316841",
    label: "PS5 Slim 1TB Digital Edition",
    itemId: "316841",
    productUrl: "https://www.croma.com/sony-playstation-5-1tb-ssd-digital-edition-slim-gaming-console-white-/p/316841",
  }),
  cromaTarget({
    idSuffix: "ps5-slim-305985",
    label: "PS5 Slim 1TB (original listing)",
    itemId: "305985",
    productUrl: "https://www.croma.com/sony-playstation-5-slim-1tb-ssd-gaming-console-white-/p/305985",
  }),

  // --- Quick-commerce examples (BigBasket, Flipkart Minutes, Blinkit,
  // Swiggy Instamart, Zepto, ...) -----------------------------------------
  //
  // Unlike the mainstream retailers above, these DO gate real-time stock
  // behind a delivery pincode/address (they run dark-store fulfillment, not
  // one national inventory pool) - so per-city checks are meaningful here,
  // via `preActions` driving each site's location picker. Blinkit and Zepto
  // are now CONFIRMED WORKING (see their own comments below) - Instamart's
  // location picker was live-tested and found NOT to work headless (see its
  // comment below for the finding), and BigBasket/Flipkart Minutes were not
  // live-verified with the same rigor - every id/selector/pincode for those
  // two is still a PLACEHOLDER. Open the real site in a browser, inspect the
  // location picker and stock badge with DevTools, and replace these before
  // running against a live site. See README.md -> "Quick-commerce platforms"
  // for per-platform feasibility notes.

  {
    id: "bigbasket-ps5-411001",
    label: "BigBasket - Pune 411001",
    url: "https://www.bigbasket.com/pd/example-product-slug/",
    strategy: "dom",
    preActions: [
      { action: "click", selector: "[data-testid='select-location']" },
      { action: "fill", selector: "input[name='pincode']", value: "411001", waitAfterMs: 1000 },
      { action: "click", selector: "[data-testid='pincode-confirm']", waitAfterMs: 1500 },
    ],
    selector: "[data-testid='product-availability']",
    inStockValues: ["add to basket", "in stock"],
  },
  {
    id: "flipkart-minutes-ps5-560001",
    label: "Flipkart Minutes - Bengaluru 560001",
    url: "https://www.flipkart.com/example-product/p/example-id",
    strategy: "dom",
    preActions: [
      { action: "click", selector: "#location-widget" },
      { action: "fill", selector: "input[name='pincode']", value: "560001", waitAfterMs: 1000 },
      { action: "click", selector: "button._2QwZfM", waitAfterMs: 1500 },
    ],
    selector: "._16FRp0", // Flipkart's class names are obfuscated/rotate often - re-verify frequently
    inStockValues: ["add to cart"],
  },
  // --- Quick-commerce pincodes (Blinkit/Zepto/Instamart), sourced from
  // data/pincodes.json (quickCommerce: true rows) - see the
  // quickCommercePincodeTargets factory above for the per-row target set and
  // the searchText field's purpose. Includes the 3 formerly-hardcoded
  // full-address rows (Kadugodi/Jeevan Bheema Nagar/Chikkabellandur). -------
  ...PINCODE_ENTRIES.filter((e) => e.quickCommerce).flatMap(quickCommercePincodeTargets),
];
