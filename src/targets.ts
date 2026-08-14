import { InStockConfirmation, Platform, Target } from "./types";
import { PincodeEntry, loadPincodeEntriesSync } from "./pincodeStore";
import { loadPlatformSwitchesSync } from "./platformStore";

/**
 * ZEPTO - removed 2026-08-07 when Zepto delisted the PS5 (both product pages
 * served its 404 "egg-sit" page), RESTORED 2026-08-13 after it relisted both
 * consoles at the SAME pvids as before. Everything below was re-verified live
 * against the relisted pages on 2026-08-13, not just restored from git.
 *
 * Zepto's location picker responds to headless automation: click
 * `[data-testid='user-address']` to open the modal, fill
 * `[data-testid='address-search-input'] input`, then click the first
 * `[data-testid='address-search-item']`.
 *
 * The ~7000ms wait after that click is LOAD-BEARING, not padding: the DOM
 * keeps showing the STALE default "Add to Cart" for ~2.2s after the click,
 * and a shorter wait produced real false alerts (live-verified 2026-07-08).
 *
 * WHY THE CONFIRMATION GUARDS ARE NOT OPTIONAL: Zepto's default/no-location
 * view of an OUT OF STOCK product shows the exact same "Add to Cart" CTA as a
 * genuinely in-stock store, so a naive read of the buy-box alone cannot tell
 * them apart - re-confirmed 2026-08-13, where the no-location view of both
 * consoles read "Add to Cart" while 13 of 17 pincodes were actually sold out.
 */
const ZEPTO_IN_STOCK_CONFIRMATIONS: InStockConfirmation[] = [
  // 1. The picker actually applied: the header address stops reading the
  //    default "Select Location" prompt once a real address is set.
  { selector: "[data-testid='user-address']", rejectAny: ["select location"] },
  // 2. A serviceable dark store resolved: Zepto renders a delivery ETA
  //    ("N minutes") for ANY serviceable location - in-stock or out-of-stock
  //    alike - but never on the unresolved/default view.
  { selector: "header", matches: "\\d+\\s*min" },
];

/**
 * The PS5 SKUs Zepto lists. `pvid` is the product id in the page URL.
 *
 * DIGITAL EDITION DROPPED 2026-08-14, on price/desirability grounds ONLY:
 * pvid 4dd0b8da-d86d-4d40-8ab9-8413ebeec4df, CFI-2008B01X, MRP 49990 - a
 * discontinued SKU at an old price that is not worth being alerted about.
 * Its stock reads were REAL, not phantom. Restore by re-adding the entry.
 *
 * DO NOT use "absent from Zepto's catalog search" as evidence a listing is
 * dead - that reasoning was tried on 2026-08-14 and is WRONG. Searching the
 * serving store (Hagadur/560066) for "ps5", "ps5 console" and "playstation 5
 * console" returns ~81 results with ZERO consoles among them, yet BOTH
 * consoles were genuinely in stock that morning and both had sold out by
 * 11:33 IST. Zepto just excludes consoles from general search; the direct PDP
 * this checker hits is the only place they surface.
 *
 * The signal that a read is real, not a stale page: it VARIES - across stores
 * (13 of 17 pincodes sold out while Hagadur had stock) and over time (both
 * consoles flipping to "Notify Me when back in stock" within ~90 minutes). A
 * genuinely dead page reads the same everywhere, forever.
 */
const ZEPTO_PS5_SKUS = [
  {
    idPrefix: "zepto-ps5",
    labelSuffix: "",
    slug: "playstation-5-console-standard",
    pvid: "ad968d7d-c5d8-415e-b7d4-58f84ff13076",
  },
] as const;

type ZeptoSku = (typeof ZEPTO_PS5_SKUS)[number];

function zeptoTarget(entry: PincodeEntry, sku: ZeptoSku): Target {
  const { id, pincode, city } = entry;
  return {
    id: `${sku.idPrefix}-${id}`,
    platform: "zepto",
    label: `Zepto - ${city} ${pincode}${sku.labelSuffix}`,
    url: `https://www.zepto.com/pn/${sku.slug}/pvid/${sku.pvid}`,
    strategy: "dom",
    preActions: [
      { action: "click", selector: "[data-testid='user-address']" },
      // searchText over the bare pincode where set, for the same reason as
      // Blinkit: a bare pincode can resolve to more than one dark-store zone.
      {
        action: "fill",
        selector: "[data-testid='address-search-input'] input",
        value: entry.searchText || pincode,
        waitAfterMs: 2000,
      },
      { action: "click", selector: "[data-testid='address-search-item']", waitAfterMs: 7000 },
    ],
    // Scoped to the buy-box only (title/price/CTA). A page-wide selector would
    // false-positive on the "More from SONY" carousel, which renders its own
    // "ADD" buttons for other products. This is a hashed CSS-module class that
    // can rotate on a Zepto redeploy - re-verify if this target starts erroring.
    selector: ".KQfnF.ckhcV",
    outOfStockValues: ["notify me", "out of stock"],
    inStockValues: ["add to cart"],
    inStockConfirmations: ZEPTO_IN_STOCK_CONFIRMATIONS,
  };
}

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
    platform: "croma",
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
    platform: "reliancedigital",
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
    // The same offer's `long_lat` ([lon, lat] of the fulfilling store) is
    // captured for detectPhantomStock rather than shown - a raw coordinate
    // pair means nothing to someone reading an alert, but the distance from
    // it to this pincode is the strongest phantom signal available anonymously.
    contextJsonPaths: ["long_lat"],
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
    platform: "reliancedigital",
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
    platform: "gamestheshop",
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
 * Builds one Amazon.in product target - all of them read the same
 * `#availability` buy-box line, live-verified 2026-08-07 to be present and
 * meaningful in EVERY state on amazon.in:
 *   in stock     -> "In stock" (verified on an in-stock listing, DualSense
 *                   B08GZ6QNTC, at the same moment every PS5 console listing
 *                   read unavailable - so this is a real live contrast, not a
 *                   guess about what the in-stock template says)
 *   out of stock -> "Currently unavailable. We don't know when or if this
 *                   item will be back in stock."
 *   pre-order    -> "This item will be released on <date>. Pre-order now."
 *                   (verified on GTA VI, B0H6X8VNQC)
 *
 * WHY THIS IS A FACTORY NOW - THE MISSED-RESTOCK BUG (found 2026-08-07 after
 * the user reported Amazon restocking repeatedly with no alert ever firing):
 * this file tracked exactly ONE Amazon ASIN, B08FV5GC28 - the 2020 launch
 * console (CFI-1008A01R). That listing is retired: it has read "Currently
 * unavailable. We don't know when or if this item will be back in stock."
 * continuously since this checker started (state.json shows its status never
 * once changed from OUT_OF_STOCK between 2026-07-08 and 2026-08-03), and it
 * is NOT the listing Amazon India actually restocks. Nothing was broken in
 * the scraper - it was faithfully reporting a dead page.
 *
 * The live console listings were found 2026-08-07 by walking Amazon's own
 * PlayStation 5 > Consoles bestseller node (/gp/bestsellers/videogames/
 * 20904636031/) - NOT by keyword search, which is worth remembering: a
 * search for "ps5 slim" / "playstation 5 pro" on amazon.in returns almost
 * nothing but accessories, because Amazon deprioritises out-of-stock console
 * listings out of search results entirely. The bestseller node still ranks
 * them, so it is the reliable way to re-discover ASINs if Sony relists.
 *
 * All the ASINs below read "Currently unavailable" at wiring time (2026-08-07)
 * - which is the genuine state of PS5 consoles on amazon.in right now, and
 * also why no MRP/price is visible on any of them (Amazon hides the price
 * block entirely on an unavailable listing).
 *
 * NO PS5 PRO LISTING EXISTS to track: checked both pages of the Consoles
 * bestseller node plus targeted searches - amazon.in has no Sony-sold
 * PlayStation 5 Pro console listing at all, only third-party Pro accessories
 * (stands, cases, cooling docks). If Sony lists one, add it here.
 *
 * Location caveat (unchanged, see the IMPORTANT note above TARGETS): Amazon
 * resolves delivery location from the request IP and its picker can't be
 * driven headless - but console availability on amazon.in is a national
 * "is this orderable at all" signal, so that only affects the delivery ETA,
 * not the in/out-of-stock read these targets make.
 */
function amazonTarget(opts: { idSuffix: string; label: string; asin: string }): Target {
  return {
    id: `amazon-${opts.idSuffix}`,
    platform: "amazon",
    // "location = wherever this script runs from" kept in every label so an
    // alert is never mistaken for a per-city read - see the note above.
    label: `Amazon.in - ${opts.label} (location = wherever this script runs from)`,
    url: `https://www.amazon.in/dp/${opts.asin}`,
    strategy: "dom",
    selector: "#availability",
    // Live-verified 2026-07-16 against a real active pre-order listing (GTA
    // VI, same #availability selector), re-confirmed 2026-08-07: a
    // not-yet-released item reads "This item will be released on <date>.
    // Pre-order now." Dormant for already-released console SKUs, but free to
    // check and would catch a pre-order window on a newly listed SKU/bundle.
    comingSoonValues: ["will be released on", "pre-order now"],
    outOfStockValues: ["currently unavailable", "out of stock"],
    // Deliberately only the phrases observed live - "Only 2 left in stock"
    // and "Only 1 left in stock - order soon" both contain "in stock", so
    // they are already covered without guessing at extra templates.
    inStockValues: ["in stock", "few left", "hurry"],
  };
}

/**
 * Every Amazon.in listing Sony sells a PS5 console through, from the
 * PlayStation 5 > Consoles bestseller node (see amazonTarget above for how
 * this list was built and how to refresh it). Bundles are included
 * deliberately - a console restock on amazon.in frequently lands on a bundle
 * SKU (Fortnite/ASTRO BOT/FC 26/COD) while the plain console listing stays
 * unavailable, so tracking only the two plain SKUs would still miss stock.
 */
const AMAZON_PS5_LISTINGS: { idSuffix: string; label: string; asin: string }[] = [
  // --- Plain console SKUs ---
  { idSuffix: "ps5-slim-disc", label: "PS5 Slim Console (Disc)", asin: "B0CY5HVDS2" },
  { idSuffix: "ps5-slim-digital", label: "PS5 Slim Digital Edition Console", asin: "B0CY5QW186" },
  // Separate, newer listing for the same Slim console, sold by "Sony India
  // Private Limited-DL" rather than the Sony seller account behind
  // B0CY5HVDS2 - ranked #2 in the Consoles bestseller node at wiring time,
  // i.e. it is actively selling, so it gets its own target.
  { idSuffix: "ps5-slim-sony-india", label: "PS5 Slim Console (Sony India listing)", asin: "B0GNMKL3VP" },
  // Older but still highly-ranked "Sony PS5 Console" listing (1,626 ratings).
  { idSuffix: "ps5-console-legacy", label: "PS5 Console (legacy listing)", asin: "B0BRCP72X8" },
  // The originally-tracked 2020 launch model (CFI-1008A01R, ASIN B08FV5GC28)
  // was REMOVED 2026-08-07 as a discontinued console generation: it has been
  // permanently unavailable for the entire life of this checker (see the
  // missed-restock note above) and only current-generation SKUs are tracked
  // now. To restore it as a relist tripwire, re-add:
  //   { idSuffix: "ps5-launch-cfi-1008a01r", label: "PS5 Console CFI-1008A01R (2020 launch listing)", asin: "B08FV5GC28" },

  // --- Console bundles (each is a full console, not an accessory) ---
  { idSuffix: "ps5-two-controllers-bundle", label: "PS5 Console + 2 DualSense Bundle", asin: "B0DT9MQQC1" },
  { idSuffix: "ps5-disc-fortnite-bundle", label: "PS5 Slim Disc - Fortnite Bundle", asin: "B0DN1QD11J" },
  { idSuffix: "ps5-digital-fortnite-bundle", label: "PS5 Slim Digital - Fortnite Bundle", asin: "B0DN1QNDWC" },
  { idSuffix: "ps5-disc-fortnite-chaos-bundle", label: "PS5 Console - Fortnite Flowering Chaos Bundle", asin: "B0G66KXDKQ" },
  { idSuffix: "ps5-digital-fortnite-chaos-bundle", label: "PS5 Digital - Fortnite Flowering Chaos Bundle", asin: "B0G65CWFQF" },
  { idSuffix: "ps5-cod-bundle", label: "PS5 Slim Standard - Call of Duty Bundle", asin: "B0FG835ZCY" },
  { idSuffix: "ps5-disc-astrobot-bundle", label: "PS5 Slim Disc - ASTRO BOT Bundle", asin: "B0DZHLP255" },
  { idSuffix: "ps5-digital-astrobot-bundle", label: "PS5 Slim Digital - ASTRO BOT Bundle", asin: "B0DZHNKSFW" },
  { idSuffix: "ps5-digital-fc26-bundle", label: "PS5 Slim Digital - EA SPORTS FC 26 Bundle", asin: "B0FWJFND2Q" },
  { idSuffix: "ps5-digital-30th-anniversary", label: "PS5 Digital - 30th Anniversary Limited Edition", asin: "B0DL68YCW9" },
];

/**
 * Every pincode/address this file tracks now lives in data/pincodes.json,
 * managed via `npm run admin` (browser UI) instead of editing this file -
 * see src/pincodeStore.ts for the schema. Each row's `quickCommerce`/
 * `relianceDigital` flags pick which of the two generators below it feeds:
 * the Reliance Digital list is a smaller curated set (one representative
 * pincode per city - nearby pincodes resolve to the same regional store, so
 * checking all of them would just repeat the same answer per SKU), while
 * quick-commerce (Blinkit) fans out to every pincode since each dark-store
 * zone can genuinely differ.
 *
 * Exactly one row (560001) carries relianceDigital: true - dropping that flag
 * from every row would silently take Reliance Digital coverage to zero, since
 * this filter is the only thing that generates its targets.
 */
const PINCODE_ENTRIES = loadPincodeEntriesSync();

/**
 * The 3 Reliance Digital targets (per SKU) for one pincode entry - see the
 * relianceDigitalTarget factory above for the verified per-pincode contract.
 *
 * A now-removed SKU, `sony-playstation-5-digital-edition-console` (the
 * original pre-Slim Digital Edition), was dropped 2026-08-07: it is a
 * discontinued console generation, and its live price probe confirmed it as
 * the oldest price tier still listed anywhere (MRP 44,990 vs 54,990/49,990
 * for the two Slim SKUs). Only current-generation MRPs are tracked now.
 *
 * `ps5-standard-e-chassis` (CFI-2116A01Y, MRP 69,990) was ADDED 2026-08-07
 * after the user flagged it as RD's current standard-console listing. It is a
 * genuinely DIFFERENT product from the two Slim SKUs, not a re-slug of one -
 * live-verified via the v1.0 product endpoint, which reports Model
 * CFI-2116A01Y against the Slims' CFI-2008A01X / CFI-2008B01X, and all three
 * slugs answer 200 concurrently. So it is added alongside them, not swapped in.
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
      idSuffix: "ps5-standard-e-chassis",
      label: "PS5 Standard Console CFI-2116A01Y (E-chassis)",
      slug: "sony-ps5-standard-sa-e-chassis-gaming-console-mmeqbt-9974618",
      pincode,
      city,
    }),
  ];
}

/**
 * The 4 quick-commerce targets for one pincode entry: Blinkit x2 SKUs and
 * Zepto x2 SKUs. Swiggy Instamart remains out (unreachable headless, see its
 * note below). Uses `entry.searchText` instead of the bare pincode when set -
 * needed because a bare-pincode search on Zepto/Blinkit can resolve
 * ambiguously to more than one dark-store zone (live-verified case: pincode
 * 560067/Kadugodi returned multiple distinct locality suggestions serving
 * different stores) - a fuller address string makes the first suggestion
 * clicked deterministically the right store. `entry.id` (not the bare
 * pincode) is the id suffix so rows with a custom address get their own
 * distinct target ids alongside a plain-pincode row for the same pincode.
 */
/**
 * The PS5 SKUs Blinkit lists. `prid` is both the product id in the page URL
 * and the `product_id` the availability API keys its stock fields on.
 */
const BLINKIT_PS5_SKUS = [
  {
    idPrefix: "blinkit-ps5",
    labelSuffix: "",
    prid: "779739",
    slug: "playstation-5-digital-edition-gaming-console-white",
  },
  {
    // Added 2026-07-29 - newer console revision (CFI-2116A01Y, Standard
    // Edition), a different listing from the Digital Edition above (added
    // alongside it, not replacing it, so both stay tracked).
    idPrefix: "blinkit-ps5-cfi-2116a01y",
    labelSuffix: " (CFI-2116A01Y Standard Edition)",
    prid: "763266",
    slug: "playstation-cfi-2116a01y-5-gaming-console-standard-edition-e-chassis-white",
  },
] as const;

type BlinkitSku = (typeof BLINKIT_PS5_SKUS)[number];

/**
 * Blinkit availability WITHOUT a browser page render or a location picker -
 * reverse-engineered from the PDP's own traffic and live-verified
 * 2026-08-07.
 *
 *   POST /v1/layout/product/<prid>   headers: lat, lon, app_client
 *
 * No auth, no cookies, no pincode text - the delivery location is purely the
 * lat/lon pair, which is why quick-commerce rows carry `lat`/`lon`
 * (backfilled by `npm run resolve-latlon` from Blinkit's own geocoder, so
 * the coordinate matches what its picker would have set).
 *
 * Verified per-location, not a national flag: at one moment the DualSense
 * controller (a product that was actually in stock, so differences show)
 * read inventory 4 in Bangalore, 1 in Delhi and 0 in Mumbai. This is a real
 * per-coordinate signal - unlike the old Instamart targets, which faked
 * per-pincode checks and were removed.
 *
 * WHY BOTH FIELDS: `inventory` alone false-positives. The same live run read
 * Delhi as inventory 1 but is_sold_out TRUE - a non-zero count that is not
 * actually buyable. So `is_sold_out` is the authoritative CTA signal and a
 * positive `inventory` is required as corroboration; either one failing
 * means out of stock. Both are checked as delimited `field=value;` tokens
 * (see JsonFind) so "inventory=0;" can't also match inventory 100.
 *
 * COMING SOON - the field DOES exist, found 2026-08-07 by diffing this API
 * path against the old DOM path it replaced. The two disagreed on 10 of 20
 * targets: the DOM path read COMING_SOON for the CFI-2116A01Y SKU (Blinkit's
 * "Coming soon" badge) where the API path read OUT_OF_STOCK. The DOM path was
 * right - dropping to the safe default would have silently killed every
 * coming-soon alert this checker fires from Blinkit, which is the earliest
 * warning a restock is being staged.
 *
 * The response does carry a "Coming soon" product_badges entry, but badges
 * live on a sibling snippet object with no product_id on it - unusable for
 * jsonFind, which flattens ONE product object. `product_state` is the right
 * field: a scalar on the product object itself, sitting beside is_sold_out.
 * Live-verified 2026-08-07 across 24 product objects in a single response
 * (the tracked SKU plus every recommendation-carousel item):
 *   "available"    + is_sold_out=false  -> orderable now      (x22)
 *   "coming_soon"  + is_sold_out=true   -> pre-launch badge   (x2, the
 *                                          CFI-2116A01Y SKU)
 *   "out_of_stock" + is_sold_out=true   -> genuinely sold out (the Digital
 *                                          Edition SKU, same moment)
 * comingSoonValues is checked before outOfStockValues (see resolveStatus), so
 * a coming_soon SKU routes to COMING_SOON even though is_sold_out is true -
 * exactly what the DOM path did.
 */
function blinkitApiTarget(entry: PincodeEntry, sku: BlinkitSku): Target {
  const { id, pincode, city } = entry;
  return {
    id: `${sku.idPrefix}-${id}`,
    platform: "blinkit",
    label: `Blinkit - ${city} ${pincode}${sku.labelSuffix}`,
    url: `https://blinkit.com/v1/layout/product/${sku.prid}`,
    // The raw endpoint is useless to a human racing a restock - link the
    // real product page instead.
    displayUrl: `https://blinkit.com/prn/${sku.slug}/prid/${sku.prid}`,
    // NOT "api": this endpoint is behind Cloudflare bot management that
    // rejects Node's TLS fingerprint outright (axios/undici/Playwright's
    // APIRequestContext all 403 while curl and a real page both 200) - see
    // CheckStrategy in types.ts for the full finding.
    strategy: "browser-api",
    method: "POST",
    requestHeaders: {
      lat: String(entry.lat),
      lon: String(entry.lon),
      app_client: "consumer_web",
    },
    requestBody: {},
    // Located by product id, never by position: this response repeats the
    // same stock fields on ~90 objects (cart stubs, analytics, and every
    // "you might also like" item), so a fixed dot-path would be one layout
    // change away from silently reading a different product.
    jsonFind: { where: "product_id", equals: sku.prid, select: ["is_sold_out", "inventory", "product_state"] },
    // Checked first (see resolveStatus), so a pre-launch SKU reads
    // COMING_SOON instead of being swallowed by is_sold_out=true below -
    // this is what the DOM path did and what the API path lost until
    // 2026-08-07. See the product_state findings in the doc comment above.
    comingSoonValues: ["product_state=coming_soon;"],
    outOfStockValues: ["is_sold_out=true;", "inventory=0;"],
    inStockValues: ["is_sold_out=false;"],
  };
}

/**
 * The original browser/location-picker Blinkit check, kept ONLY as the
 * fallback for rows with no resolved coordinate (run `npm run resolve-latlon`
 * to move a row onto the ~20x faster API path above). The picker itself is
 * verified working - original 2026-07-08 live test on pincode 110001 - but
 * it costs a full page render plus ~5s of scripted waits per check, and
 * driving a UI is far more bot-detectable than the JSON call.
 */
function blinkitDomTarget(entry: PincodeEntry, sku: BlinkitSku): Target {
  const { id, pincode, city } = entry;
  const locationValue = entry.searchText || pincode;
  return {
    id: `${sku.idPrefix}-${id}`,
    platform: "blinkit",
    label: `Blinkit - ${city} ${pincode}${sku.labelSuffix}`,
    url: `https://blinkit.com/prn/${sku.slug}/prid/${sku.prid}`,
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
  };
}

function quickCommercePincodeTargets(entry: PincodeEntry): Target[] {
  // A row only reaches the API path once its coordinate is known; until
  // then it keeps working the slow way rather than silently dropping out of
  // the check list.
  const hasCoordinate = typeof entry.lat === "number" && typeof entry.lon === "number";
  return [
    ...BLINKIT_PS5_SKUS.map((sku) =>
      hasCoordinate ? blinkitApiTarget(entry, sku) : blinkitDomTarget(entry, sku)
    ),
    ...ZEPTO_PS5_SKUS.map((sku) => zeptoTarget(entry, sku)),
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
 * Amazon.in - CONFIRMED WORKING, high confidence in the READ; the risk here
 *   is picking the wrong LISTING, not misreading it. `#availability` was
 *   re-verified live 2026-08-07 to carry a distinct, unambiguous line in all
 *   three states (in stock / currently unavailable / pre-order) - see the
 *   amazonTarget factory below. What actually caused a month of missed
 *   Amazon restocks was tracking a single retired ASIN, so the rule for this
 *   retailer is: re-check the PlayStation 5 > Consoles BESTSELLER node
 *   periodically for new/relisted SKUs rather than trusting a fixed URL to
 *   stay the one Amazon restocks. Amazon's location-change modal
 *   (`#nav-global-location-popover-link` -> `#GLUXZipUpdateInput` ->
 *   `#GLUXZipUpdate`) still would not apply a new pincode under headless
 *   Playwright - its bot detection specifically obstructs that interactive
 *   flow - but console availability here is national, so that only affects
 *   the delivery ETA, not the stock read.
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
/**
 * Every target this file knows how to build, before the per-platform on/off
 * switches are applied. Exported for the admin UI, which needs the counts for
 * platforms that are currently switched OFF - those are absent from TARGETS by
 * definition, so it can't count them there. The checker should always use
 * TARGETS (below), never this.
 */
export const buildAllTargets = (entries: PincodeEntry[]): Target[] => [
  // --- SONY CENTER (shopatsc.com) - REMOVED 2026-08-07. Sony's own retail
  // chain has stopped selling PS5 consoles online: both tracked Shopify
  // product endpoints (/products/playstation-5-standard-edition.js and
  // -digital-edition.js) now return 404, and its whole playstation-5
  // collection - 67 products pulled live via products.json - contains no
  // console at all, only console COVERS and accessories. A catalog search
  // for "ps5 console" returns zero product hits. Nothing to track.
  //
  // Ironically this was documented as "the most reliable target in this
  // file" (a clean Shopify `available: true/false` boolean, no scraping, no
  // bot detection) - and the read never broke. The retailer simply left the
  // market. TO RE-ADD: if shopatsc.com relists a console, the Shopify
  // contract still holds - point an "api" target at
  // https://shopatsc.com/products/<handle>.js with jsonPath "available" and
  // inStockValues ["true"]. Find the handle via
  // https://shopatsc.com/search/suggest.json?q=<query>&resources[type]=product
  // or /collections/playstation-5/products.json?limit=250.

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
  // --- Amazon.in, reworked 2026-08-07 from a single (retired) ASIN to every
  // listing Sony actually sells a PS5 console through - see the amazonTarget
  // factory above for the missed-restock post-mortem, the verified
  // #availability contract, and how the ASIN list was sourced. IMPORTANT:
  // "location" for these is wherever this script's network connection
  // resolves to, not a chosen city - see the IMPORTANT note above this array.
  ...AMAZON_PS5_LISTINGS.map(amazonTarget),
  {
    id: "flipkart-national",
    platform: "flipkart",
    label: "Flipkart - PS5 console (location = wherever this script runs from)",
    url: "https://www.flipkart.com/sony-playstation5-console-slim-cfi-2008a01x-1024-gb/p/itm89489e2adcd2c",
    strategy: "dom",
    selector: "script#jsonLD",
    outOfStockValues: ["schema.org/outofstock"],
    inStockValues: ["schema.org/instock"],
  },
  // --- SWIGGY INSTAMART - REMOVED 2026-08-07. It never once completed a
  // check: data/state.json has no entry for it at all, meaning every run
  // since it was wired ended in an exception rather than a stock reading.
  // Two independent reasons, both re-verified live 2026-08-07:
  //   1. The item page itself no longer renders for automation - it returns
  //      Swiggy's error screen ("Something went wrong! Our best minds are on
  //      this"), with only `simpleheader-back` and `error-button` testids in
  //      the entire DOM.
  //   2. Even when it did render, the target was structurally incapable of
  //      reporting stock: its selector `[data-testid='sold-out']` EXISTS ONLY
  //      IN THE SOLD-OUT STATE. On a restock that element simply never
  //      appears, so waitForSelector burns the full 30s timeout and the check
  //      throws - the one event this target existed to catch was the exact
  //      event it could not report. A working Instamart target would have to
  //      watch a container present in BOTH states, matching "sold out" vs
  //      "add" inside it.
  // Earlier findings that still stand: the product page has no location
  // picker at all (every data-testid was dumped - nothing address-related),
  // and Instamart's homepage, the only place with a real address flow, is
  // bot-blocked outright headless ("Request Blocked - Your request looks
  // automated"), so this could never have been a per-pincode check either.
  {
    // Added 2026-07-27 - newer console revision (CFI-2116A01Y) bundled with
    // Astro's Playroom, different listing/pid from flipkart-national above.
    // Same jsonLD-based strategy and same location caveat applies.
    id: "flipkart-ps5-cfi-2116-astros-playroom",
    platform: "flipkart",
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
  ...entries.filter((e) => e.relianceDigital).flatMap(relianceDigitalPincodeTargets),

  // --- Reliance Digital pre-order watch, added 2026-07-16 - see the
  // relianceDigitalPreOrderTarget factory above for the verified
  // `_custom_json.pre_order_enabled` contract. One target per SKU (not
  // fanned out per pincode - pre-order eligibility isn't pincode-dependent).
  // All read `pre_order_enabled: false` at wiring time. The pre-Slim
  // `sony-playstation-5-digital-edition-console` watch was dropped alongside
  // its stock target on 2026-08-07, and the CFI-2116A01Y watch added the same
  // day alongside its - see relianceDigitalPincodeTargets above.
  // -------------------------------------------------------------------------
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
    idSuffix: "ps5-standard-e-chassis",
    label: "PS5 Standard Console CFI-2116A01Y (E-chassis)",
    slug: "sony-ps5-standard-sa-e-chassis-gaming-console-mmeqbt-9974618",
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

  // --- Quick-commerce (Blinkit + Zepto; BigBasket, Flipkart Minutes and
  // Swiggy Instamart removed 2026-08-07) -----------------------------------
  //
  // Unlike the mainstream retailers above, these DO gate real-time stock
  // behind a delivery pincode/address (they run dark-store fulfillment, not
  // one national inventory pool) - so per-city checks are meaningful here,
  // via `preActions` driving each site's location picker. Blinkit and Zepto
  // are both CONFIRMED WORKING (see their comments in
  // quickCommercePincodeTargets above); Instamart's location picker was
  // live-tested and found NOT to work headless (see its removal note above).
  //
  // BIGBASKET AND FLIPKART MINUTES - REMOVED 2026-08-07. Both shipped as
  // never-verified PLACEHOLDERS: their urls were literally
  // `bigbasket.com/pd/example-product-slug/` and
  // `flipkart.com/example-product/p/example-id`, with invented selectors and
  // pincodes to match. They could never report stock - every cycle they
  // simply timed out waiting for a selector on a page that doesn't exist,
  // burning the full 30s request timeout each (a minute per cycle between
  // them, on a cycle that already struggles to finish) and dropping a
  // useless screenshot + HTML dump into data/debug/ every single run.
  // Deleted rather than left in place because a placeholder that always
  // fails is indistinguishable, in the logs, from a real target that just
  // broke. To add either platform for real: open the actual PS5 product page
  // in a browser, inspect its location picker and stock badge with DevTools,
  // and write a target from what's really there - the way the Blinkit and
  // Zepto targets below were built. See README.md -> "Quick-commerce
  // platforms" for per-platform feasibility notes.

  // --- Quick-commerce pincodes (Blinkit + Zepto), sourced from
  // data/pincodes.json (quickCommerce: true
  // rows) - see the quickCommercePincodeTargets factory above for the per-row
  // target set and the searchText field's purpose. The pincode list was cut
  // back to Bangalore-only on 2026-08-07; the former Kadugodi / Jeevan Bheema
  // Nagar / Chikkabellandur full-address rows went with it, and 560035 is now
  // a plain-pincode row rather than the Chikkabellandur address row. --------
  ...entries.filter((e) => e.quickCommerce).flatMap(quickCommercePincodeTargets),
];

/**
 * Every target this file knows how to build for the pincode list on disk,
 * BEFORE the per-platform on/off switches are applied. The checker should
 * always use TARGETS (below), never this.
 */
export const ALL_TARGETS: Target[] = buildAllTargets(PINCODE_ENTRIES);

/**
 * Which retailers are switched on, read from data/platforms.json at import
 * time - same load-once model as the pincode list, so a change here takes
 * effect on the next process start (or the next GitHub Actions run once the
 * file is committed), not mid-cycle.
 */
const PLATFORM_SWITCHES = loadPlatformSwitchesSync();

/**
 * How many targets each platform contributes, switched on or not. Takes the
 * target list as an argument rather than closing over ALL_TARGETS so the admin
 * UI can recount against a freshly-read pincode file - its counts for the
 * per-pincode platforms (Blinkit, Reliance Digital) change the moment a
 * pincode is added or removed, and a number frozen at server start would go
 * quietly wrong.
 */
export function countTargetsByPlatform(targets: Target[]): Record<Platform, number> {
  return targets.reduce((acc, t) => {
    acc[t.platform] = (acc[t.platform] ?? 0) + 1;
    return acc;
  }, {} as Record<Platform, number>);
}

/**
 * The targets the checker actually runs: everything above, minus any platform
 * switched off in data/platforms.json (manage them with `npm run admin`).
 *
 * A switched-off platform is dropped HERE, before index.ts ever sees it - no
 * request is made, no state entry is written, and no alert can fire for it.
 * Existing history in data/state.json is left untouched, so switching a
 * platform back on resumes exactly where it left off rather than re-alerting
 * on a status it was already at.
 */
export const TARGETS: Target[] = ALL_TARGETS.filter((t) => PLATFORM_SWITCHES[t.platform]);
