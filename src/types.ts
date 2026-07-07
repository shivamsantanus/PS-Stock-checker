export type StockStatus = "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export type CheckStrategy = "dom" | "api";

/**
 * A UI step run before reading the stock selector - needed on quick-commerce
 * sites (Blinkit, Instamart, Zepto, ...) where availability isn't visible
 * until a delivery pincode/address is set via an on-page picker.
 */
export interface PreAction {
  action: "fill" | "click";
  selector: string;
  value?: string; // required for "fill"
  waitAfterMs?: number; // pause after the action, e.g. to let a dropdown/suggestion list settle
}

export interface CookieSeed {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

/**
 * A single location to monitor. `url` is the page (dom strategy) or
 * JSON endpoint (api strategy) to hit for that specific location.
 */
export interface Target {
  id: string; // stable unique key, used for state tracking - never change once set
  label: string; // human readable name shown in logs/notifications
  url: string;
  strategy: CheckStrategy;
  // dom strategy: CSS selector whose text/attribute reveals stock state
  selector?: string;
  // api strategy: dot-path into the JSON response, e.g. "data.availability.status"
  jsonPath?: string;
  // Values (case-insensitive substring match) that count as "in stock" for this target.
  inStockValues: string[];
  // dom strategy only, optional: cookies set on the browser context before navigating -
  // use for sites that read delivery location/pincode from a cookie.
  cookies?: CookieSeed[];
  // dom strategy only, optional: UI steps run after page load and before reading
  // `selector` - use to type a pincode into a location picker and confirm it.
  preActions?: PreAction[];
}

export interface StockResult {
  target: Target;
  status: StockStatus;
  checkedAt: string; // ISO timestamp
  detail?: string; // raw matched text, for debugging
  error?: string;
}

export interface StateEntry {
  status: StockStatus;
  lastCheckedAt: string;
  lastChangedAt: string;
}

export type StateMap = Record<string, StateEntry>;
