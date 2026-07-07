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
];
