export type StockStatus = "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export type CheckStrategy = "dom" | "api";

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
