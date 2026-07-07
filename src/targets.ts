import { Target } from "./types";

/**
 * The list of locations to monitor.
 *
 * Two supported strategies per target:
 *
 *  - "dom": loads `url` in a headless browser and reads the text of `selector`.
 *           Use this for store/product pages rendered client-side with JS.
 *
 *  - "api": calls `url` directly with axios (no browser) and reads `jsonPath`
 *           out of the parsed JSON response. Use this when the retailer's
 *           site quietly calls a JSON endpoint you can hit directly - it's
 *           faster, cheaper, and far less likely to get bot-blocked than a
 *           full browser render.
 *
 * NOTE: selectors and endpoints below are placeholders. Every retailer's
 * markup/API is different and changes over time - inspect the target site's
 * network tab (for "api") or DOM (for "dom") and fill in real values before
 * running this against a live site.
 */
export const TARGETS: Target[] = [
  {
    id: "store-downtown-123",
    label: "Downtown Store (Store #123)",
    url: "https://example-retailer.com/store/123/product/ps5-console",
    strategy: "dom",
    selector: "[data-testid='fulfillment-availability']",
    inStockValues: ["in stock", "available", "add to cart"],
  },
  {
    id: "store-uptown-456",
    label: "Uptown Store (Store #456)",
    url: "https://example-retailer.com/store/456/product/ps5-console",
    strategy: "dom",
    selector: "[data-testid='fulfillment-availability']",
    inStockValues: ["in stock", "available", "add to cart"],
  },
  {
    id: "zip-90210",
    label: "ZIP 90210 area",
    url: "https://example-retailer.com/api/availability?sku=PS5-CONSOLE&zip=90210",
    strategy: "api",
    jsonPath: "product.fulfillment.storeAvailability.status",
    inStockValues: ["in_stock", "limited_stock"],
  },

  // --- Quick-commerce examples (India: BigBasket, Flipkart Minutes,
  // Blinkit, Swiggy Instamart, Zepto, ...) ---------------------------------
  //
  // These apps gate availability behind a delivery pincode/address, so a
  // plain page load isn't enough - you generally have to drive their
  // location picker first via `preActions` (or set a location cookie
  // directly via `cookies`, if the site supports that). See README.md ->
  // "Quick-commerce platforms" for the full rundown, including which of
  // these are realistically scrapable long-term and which aren't.
  //
  // Every id/selector/pincode below is a PLACEHOLDER - open the real site in
  // a normal browser, inspect the location picker and the product's stock
  // badge with DevTools, and replace these before running against a live
  // site. They will not work as-is.

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
