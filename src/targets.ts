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
 * Amazon.in - CONFIRMED SELECTOR, national only, medium confidence.
 *   `#availability` reliably showed "Currently unavailable." live. Amazon's
 *   location-change modal (`#nav-global-location-popover-link` ->
 *   `#GLUXZipUpdateInput` -> `#GLUXZipUpdate`) would not actually apply a new
 *   pincode under headless Playwright in testing - its bot detection appears
 *   to specifically obstruct that interactive flow - so this checks whatever
 *   location Amazon auto-detects from the machine's IP, not a chosen city.
 *
 * Flipkart - CONFIRMED WORKING via structured data, national only, high
 *   confidence. The visible page uses auto-generated/rotating CSS class
 *   names (e.g. `css-146c3p1`) with no stable selector to grab - but every
 *   product page also embeds a `<script type="application/ld+json"
 *   id="jsonLD">` block (schema.org Product markup, kept stable on purpose
 *   for Google Shopping/SEO) containing `offers.availability`:
 *   "https://schema.org/InStock" or ".../OutOfStock". Confirmed live,
 *   present in the raw server-rendered HTML with no JS execution needed.
 *   This sidesteps the obfuscated-class problem entirely by reading a data
 *   contract Flipkart has an external incentive to keep stable, rather than
 *   its internal, freely-changing visual markup.
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
    label: "Amazon.in - PS5 console (national, no per-city override)",
    url: "https://www.amazon.in/Sony-CFI-1008A01R-PlayStation-5-console/dp/B08FV5GC28",
    strategy: "dom",
    selector: "#availability",
    outOfStockValues: ["currently unavailable", "out of stock"],
    inStockValues: ["in stock", "few left", "hurry"],
  },
  {
    id: "flipkart-national",
    label: "Flipkart - PS5 console (national, via structured data)",
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
  // via `preActions` driving each site's location picker. These were NOT
  // live-verified with the same rigor as the targets above - every
  // id/selector/pincode below is a PLACEHOLDER. Open the real site in a
  // browser, inspect the location picker and stock badge with DevTools, and
  // replace these before running against a live site. See README.md ->
  // "Quick-commerce platforms" for per-platform feasibility notes.

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
  {
    id: "blinkit-ps5-110001",
    label: "Blinkit - Delhi 110001",
    url: "https://blinkit.com/prn/example-product/prid/000000",
    strategy: "dom",
    preActions: [
      { action: "click", selector: "[data-pf='reset-location-search']" },
      { action: "fill", selector: "input[name='select-locality']", value: "110001", waitAfterMs: 1200 },
      { action: "click", selector: ".LocationSearchList__LocationLabel", waitAfterMs: 1500 },
    ],
    selector: "[data-pf='product-add-to-cart']",
    inStockValues: ["add"],
  },
  {
    id: "instamart-ps5-500001",
    label: "Swiggy Instamart - Hyderabad 500001",
    url: "https://www.swiggy.com/instamart/item/000000",
    strategy: "dom",
    preActions: [
      { action: "click", selector: "[data-testid='address-selector']" },
      { action: "fill", selector: "input[placeholder='Search for area, street name...']", value: "500001", waitAfterMs: 1200 },
      { action: "click", selector: "[data-testid='address-search-result-0']", waitAfterMs: 1500 },
    ],
    selector: "[data-testid='add-to-cart-button']",
    inStockValues: ["add"],
  },
  {
    id: "zepto-ps5-400001",
    label: "Zepto - Mumbai 400001",
    url: "https://www.zeptonow.com/pn/example-product/pvid/00000000-0000-0000-0000-000000000000",
    strategy: "dom",
    preActions: [
      { action: "click", selector: "[data-testid='address-bar']" },
      { action: "fill", selector: "input[placeholder='Search a new address']", value: "400001", waitAfterMs: 1200 },
      { action: "click", selector: "[data-testid='address-search-result-0']", waitAfterMs: 1500 },
    ],
    selector: "[data-testid='product-card-add-button']",
    inStockValues: ["add"],
  },
];
