import { Target } from "./types";

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
 * Excluded after live testing - not shipped, to avoid pretending confidence
 * that testing disproved:
 *   - Croma: blocked outright, HTTP 403 "Access Denied" on a plain page load.
 *   - Vijay Sales: has a real "Out Of Stock"/"Notify Me" vs "Add to Cart"
 *     signal, but the page interleaves multiple product cards (this item +
 *     a "related products" carousel) using the SAME classes - `.first()` on
 *     either selector returned contradictory results in testing, picking up
 *     an unrelated carousel item rather than the main product reliably.
 *   - Reliance Digital: pincode input exists, but no reachable "Apply"
 *     button was found, and the real add-to-cart/stock button rendered as an
 *     empty Vue.js placeholder on initial load.
 *   All four are architecturally supported (cookies/preActions/press exist
 *   for exactly this) if you want to pick up the investigation yourself with
 *   HEADLESS=false and DevTools - see README.md -> "Retailer confidence"
 *   for the exact anchors already found.
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
  {
    id: "amazon-national",
    // IMPORTANT: "national" here means "wherever this script's network
    // connection resolves to," not a chosen city - see the IMPORTANT note
    // above this array for why that matters and how to run it correctly.
    label: "Amazon.in - PS5 console (location = wherever this script runs from)",
    url: "https://www.amazon.in/Sony-CFI-1008A01R-PlayStation-5-console/dp/B08FV5GC28",
    strategy: "dom",
    selector: "#availability",
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
  // --- Priority pincodes, requested 2026-07-08 - checked on Blinkit, Zepto,
  // and Instamart, in this priority order: Patiala (147002, 147001), Cuttack
  // (753004, 753006), Gurugram (122098), Bhubaneswar (751012, 751006). ------
  // Added the same day: Dehradun (248001), Lucknow (226016), Bangalore
  // (560075) - live-verified end-to-end on Blinkit and Zepto (same selectors
  // as their first live-tested entries below, using the real PS5 product
  // page and pincode picker for each site).
  //
  // Instamart real product wired in 2026-07-08 (PS5 1TB Slim console,
  // https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR) - live-tested
  // against this exact URL, but the per-pincode preActions are CONFIRMED
  // NOT to work (no location picker exists on this page, and the homepage
  // flow that has one is bot-blocked headless) - see the comment on the
  // instamart-ps5-* entry below for the full finding.

  ...(
    [
      { pincode: "147002", city: "Patiala" },
      { pincode: "753004", city: "Cuttack" },
      { pincode: "753006", city: "Cuttack" },
      { pincode: "147001", city: "Patiala" },
      { pincode: "122098", city: "Gurugram" },
      { pincode: "751012", city: "Bhubaneswar" },
      { pincode: "751006", city: "Bhubaneswar" },
      { pincode: "248001", city: "Dehradun" },
      { pincode: "226016", city: "Lucknow" },
      { pincode: "560075", city: "Bangalore" },
    ] as { pincode: string; city: string }[]
  ).flatMap(({ pincode, city }): Target[] => [
    {
      // Blinkit's location picker is VERIFIED WORKING (see original
      // 2026-07-08 live test on pincode 110001) - typing a pincode into the
      // "Change Location" modal returns real suggestions, and clicking one
      // actually updates the delivery address and re-renders availability.
      id: `blinkit-ps5-${pincode}`,
      label: `Blinkit - ${city} ${pincode}`,
      url: "https://blinkit.com/prn/playstation-5-digital-edition-gaming-console-white/prid/779739",
      strategy: "dom",
      preActions: [
        // Opens the "Change Location" modal from the header.
        { action: "click", selector: "div[class*='LocationBar__Subtitle']" },
        { action: "fill", selector: "input[name='select-locality']", value: pincode, waitAfterMs: 2000 },
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
      // Net effect: every entry below will click/fill against selectors that
      // don't exist, silently no-op, and all 10 will report the SAME
      // (server-inferred) status regardless of pincode - this does NOT
      // actually check per-city availability yet. `selector` below IS
      // confirmed real (data-testid="sold-out" is genuinely present on the
      // page today), so the OUT_OF_STOCK reading itself is trustworthy -
      // just not the per-pincode part.
      id: `instamart-ps5-${pincode}`,
      label: `Swiggy Instamart - ${city} ${pincode} (location NOT verified - see comment)`,
      url: "https://www.swiggy.com/stores/instamart/item/MXX8JAYWGR",
      strategy: "dom",
      preActions: [
        { action: "click", selector: "[data-testid='address-selector']" },
        { action: "fill", selector: "input[placeholder='Search for area, street name...']", value: pincode, waitAfterMs: 1200 },
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
      id: `zepto-ps5-${pincode}`,
      label: `Zepto - ${city} ${pincode}`,
      url: "https://www.zepto.com/pn/playstation-5-console-standard/pvid/ad968d7d-c5d8-415e-b7d4-58f84ff13076",
      strategy: "dom",
      preActions: [
        // Opens the "Select Location" modal from the header.
        { action: "click", selector: "[data-testid='user-address']" },
        { action: "fill", selector: "[data-testid='address-search-input'] input", value: pincode, waitAfterMs: 2000 },
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
    },
    {
      // Same product family/site behavior as zepto-ps5-* above (standard
      // edition) - selectors, location-picker flow, and the 7000ms
      // false-positive-avoidance wait are identical, just a different
      // product page. Confirmed live 2026-07-08 that this page uses the
      // same buy-box class and correctly flips to "Notify Me when back in
      // stock" once a pincode is applied.
      id: `zepto-ps5-digital-${pincode}`,
      label: `Zepto - ${city} ${pincode} (Digital Edition)`,
      url: "https://www.zepto.com/pn/playstation-5-console-digital/pvid/4dd0b8da-d86d-4d40-8ab9-8413ebeec4df",
      strategy: "dom",
      preActions: [
        { action: "click", selector: "[data-testid='user-address']" },
        { action: "fill", selector: "[data-testid='address-search-input'] input", value: pincode, waitAfterMs: 2000 },
        { action: "click", selector: "[data-testid='address-search-item']", waitAfterMs: 7000 },
      ],
      selector: ".KQfnF.ckhcV",
      outOfStockValues: ["notify me", "out of stock"],
      inStockValues: ["add to cart"],
    },
  ]),
];
