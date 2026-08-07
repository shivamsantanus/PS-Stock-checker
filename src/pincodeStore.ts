import fs from "fs";
import fsAsync from "fs/promises";
import path from "path";

/**
 * A single location to monitor for the pincode-driven target groups
 * (quick-commerce: Blinkit, and Reliance Digital) - see
 * quickCommercePincodeTargets/relianceDigitalPincodeTargets in targets.ts for
 * how each row turns into concrete Targets. Managed via `npm run admin`
 * instead of editing targets.ts directly.
 */
export interface PincodeEntry {
  // Stable slug baked into every generated target's id - never change once
  // set, or data/state.json loses its history for that row's targets.
  id: string;
  pincode: string;
  city: string;
  // What to type into the site's location-search box; falls back to
  // `pincode` when blank. Needed for addresses where a bare pincode search
  // is ambiguous (multiple dark-store zones share the same pincode).
  searchText?: string;
  // Include this row in the Blinkit (quick-commerce) target group.
  quickCommerce: boolean;
  // Blinkit's availability API is keyed on a coordinate, not on pincode text
  // (see blinkitPincodeTargets in targets.ts), so each quick-commerce row
  // needs the lat/lon its address actually resolves to. Populated by
  // `npm run resolve-latlon`, which asks Blinkit's own geocoder the same
  // question its location picker does - keeping the coordinate identical to
  // what a real user selecting this address would get. Rows without them
  // fall back to the slower browser/location-picker path.
  lat?: number;
  lon?: number;
  // Include this row in the Reliance Digital target group.
  relianceDigital: boolean;
}

const PINCODES_FILE_PATH = path.resolve(process.cwd(), "data/pincodes.json");

const PINCODE_REGEX = /^\d{6}$/;

export function loadPincodeEntriesSync(): PincodeEntry[] {
  const raw = fs.readFileSync(PINCODES_FILE_PATH, "utf-8");
  return JSON.parse(raw) as PincodeEntry[];
}

export async function loadPincodeEntries(): Promise<PincodeEntry[]> {
  const raw = await fsAsync.readFile(PINCODES_FILE_PATH, "utf-8");
  return JSON.parse(raw) as PincodeEntry[];
}

// Write via a temp-file-then-rename, same crash-safety pattern
// stateManager.ts uses for data/state.json.
export async function savePincodeEntries(entries: PincodeEntry[]): Promise<void> {
  const dir = path.dirname(PINCODES_FILE_PATH);
  await fsAsync.mkdir(dir, { recursive: true });
  const tmpPath = `${PINCODES_FILE_PATH}.tmp`;
  await fsAsync.writeFile(tmpPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  await fsAsync.rename(tmpPath, PINCODES_FILE_PATH);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateId(pincode: string, city: string, existingIds: Set<string>): string {
  if (!existingIds.has(pincode)) return pincode;

  const citySlug = slugify(city);
  const withCity = `${citySlug}-${pincode}`;
  if (!existingIds.has(withCity)) return withCity;

  let suffix = 2;
  while (existingIds.has(`${withCity}-${suffix}`)) suffix++;
  return `${withCity}-${suffix}`;
}

export interface PincodeValidationError {
  field: string;
  message: string;
}

/** Validates the user-editable fields of a PincodeEntry (not `id`). */
export function validatePincodeInput(input: {
  pincode?: unknown;
  city?: unknown;
}): PincodeValidationError[] {
  const errors: PincodeValidationError[] = [];

  if (typeof input.pincode !== "string" || !PINCODE_REGEX.test(input.pincode)) {
    errors.push({ field: "pincode", message: "Pincode must be exactly 6 digits" });
  }
  if (typeof input.city !== "string" || input.city.trim().length === 0) {
    errors.push({ field: "city", message: "City is required" });
  }

  return errors;
}
