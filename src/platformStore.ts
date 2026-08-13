import fs from "fs";
import fsAsync from "fs/promises";
import path from "path";
import { Platform } from "./types";

/**
 * Per-retailer on/off switches, stored in data/platforms.json and edited via
 * `npm run admin`. A platform switched off has ALL of its targets filtered out
 * at the bottom of targets.ts, so the checker never loads, requests, or alerts
 * on it - it costs nothing per cycle.
 *
 * Why a switch rather than deleting targets: retailers go quiet for months and
 * come back (Amazon restocked repeatedly through a period when Croma and
 * Reliance Digital did nothing). Deleting the targets to save cycle time loses
 * the verified selectors, API contracts and hard-won post-mortems in
 * targets.ts; a switch keeps all of that intact and reversible from a browser
 * checkbox. Genuinely dead listings - a 404'd product, a retailer that left
 * the market - should still be deleted outright, since a switch implies
 * "might come back" and those won't.
 *
 * This file is the SWITCHBOARD only. It never decides what a target does, just
 * whether it runs.
 */
export interface PlatformInfo {
  id: Platform;
  /** Shown as the toggle's title in the admin UI. */
  label: string;
  /** One-liner under the title - what you actually stop checking if you switch it off. */
  description: string;
  /** Purely decorative, keeps the toggle list scannable. */
  emoji: string;
  /** True for platforms whose target count scales with the pincode list. */
  perPincode: boolean;
}

/**
 * Every retailer that has targets in targets.ts. Order here is the order the
 * toggles render in the admin UI. Keep it in sync with the Platform union in
 * types.ts - TypeScript enforces that every Platform appears exactly once,
 * because PLATFORMS is typed as a full record below.
 */
export const PLATFORMS: PlatformInfo[] = [
  {
    id: "amazon",
    label: "Amazon.in",
    description: "14 console listings - plain Slim SKUs plus every Sony bundle (Fortnite, ASTRO BOT, CoD, FC 26).",
    emoji: "📦",
    perPincode: false,
  },
  {
    id: "blinkit",
    label: "Blinkit",
    description: "2 console SKUs checked separately for every pincode below - this is the only per-pincode delivery app left.",
    emoji: "🛵",
    perPincode: true,
  },
  {
    id: "croma",
    label: "Croma",
    description: "3 listings via Croma's delivery-promise API. National stock, not per-pincode.",
    emoji: "🏪",
    perPincode: false,
  },
  {
    id: "flipkart",
    label: "Flipkart",
    description: "2 listings read from the page's structured data. National stock.",
    emoji: "🛒",
    perPincode: false,
  },
  {
    id: "gamestheshop",
    label: "Games The Shop",
    description: "2 listings from Sony's official Indian distributor's own chain. National stock.",
    emoji: "🎮",
    perPincode: false,
  },
  {
    id: "reliancedigital",
    label: "Reliance Digital",
    description: "3 SKUs per Reliance-Digital-enabled pincode, plus 3 pre-order watches. Alerts here can be phantom store stock - the alert says how far the fulfilling store is, verify before celebrating.",
    emoji: "🏬",
    perPincode: true,
  },
  {
    id: "zepto",
    label: "Zepto",
    description: "2 console SKUs per pincode. Costs a full page render each (no API path), so switching this off is the quickest way to shorten a cycle.",
    emoji: "⚡",
    perPincode: true,
  },
];

/** Switch map as stored on disk: every platform id -> enabled. */
export type PlatformSwitches = Record<Platform, boolean>;

const PLATFORMS_FILE_PATH = path.resolve(process.cwd(), "data/platforms.json");

/** Everything on - what a fresh checkout (or a missing/corrupt file) gets. */
export function defaultSwitches(): PlatformSwitches {
  return PLATFORMS.reduce((acc, p) => {
    acc[p.id] = true;
    return acc;
  }, {} as PlatformSwitches);
}

/**
 * Reconciles whatever is on disk against the current PLATFORMS list, so the
 * file can never desync from the code:
 *   - a platform missing from the file defaults to ON (a newly added retailer
 *     starts tracked, matching what you'd expect after a git pull)
 *   - a key in the file that is no longer a real platform is dropped
 *   - a non-boolean value is treated as ON rather than silently disabling a
 *     retailer on a typo
 */
function normalize(raw: unknown): PlatformSwitches {
  const switches = defaultSwitches();
  if (!raw || typeof raw !== "object") return switches;
  for (const p of PLATFORMS) {
    const value = (raw as Record<string, unknown>)[p.id];
    if (typeof value === "boolean") switches[p.id] = value;
  }
  return switches;
}

/**
 * Sync read used by targets.ts at import time (same pattern as
 * loadPincodeEntriesSync). A missing file is NOT an error - it just means
 * nothing has been switched off yet, so everything is on.
 */
export function loadPlatformSwitchesSync(): PlatformSwitches {
  try {
    return normalize(JSON.parse(fs.readFileSync(PLATFORMS_FILE_PATH, "utf-8")));
  } catch {
    return defaultSwitches();
  }
}

export async function loadPlatformSwitches(): Promise<PlatformSwitches> {
  try {
    return normalize(JSON.parse(await fsAsync.readFile(PLATFORMS_FILE_PATH, "utf-8")));
  } catch {
    return defaultSwitches();
  }
}

// Temp-file-then-rename, the same crash-safety pattern pincodeStore.ts and
// stateManager.ts use.
export async function savePlatformSwitches(switches: PlatformSwitches): Promise<void> {
  const normalized = normalize(switches);
  await fsAsync.mkdir(path.dirname(PLATFORMS_FILE_PATH), { recursive: true });
  const tmpPath = `${PLATFORMS_FILE_PATH}.tmp`;
  await fsAsync.writeFile(tmpPath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  await fsAsync.rename(tmpPath, PLATFORMS_FILE_PATH);
}
