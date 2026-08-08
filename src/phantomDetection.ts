import { logger } from "./logger";
import { PincodeEntry } from "./pincodeStore";
import { StockResult } from "./types";

interface RdStoreDetail {
  uid: number;
  name: string;
  count: number;
}

function parseStoreDetail(detail?: string): RdStoreDetail | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    return typeof parsed?.uid === "number" ? (parsed as RdStoreDetail) : null;
  } catch {
    return null;
  }
}

/** reliancedigital-<sku>-<pincode> -> { skuKey, pincode }, or null for non-RD ids. */
function parseRdTargetId(targetId: string): { skuKey: string; pincode: string } | null {
  const match = targetId.match(/^reliancedigital-(.+)-(\d{6})$/);
  return match ? { skuKey: match[1], pincode: match[2] } : null;
}

interface Coords {
  lat: number;
  lon: number;
}

/**
 * Reliance Digital reports the fulfilling store's position as `long_lat`:
 * a 2-element array of numeric STRINGS in [longitude, latitude] order (not
 * lat/lon - live-verified 2026-08-07, where the "Mantri Bangalore" store came
 * back as ["77.5707896", "12.9921276"], which is Bangalore only when read
 * lon-first). Returns null for any shape that isn't that, so a schema change
 * disables the distance rule rather than silently comparing garbage.
 */
function parseLongLat(value: unknown): Coords | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in km. Straight-line, not road distance - see the threshold note. */
function haversineKm(a: Coords, b: Coords): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * How far the fulfilling store may be from the pincode before its offer is
 * called implausible. 150km is deliberately loose: an Indian metro is ~50km
 * across at its widest, so a genuine same-city store lands far below this
 * (live-verified 2026-08-07: the one plausible offer of the three measured
 * came from a store 2.4km from 560001), while the two known-bad ones sat at
 * ~188km and ~505km. The gap between those clusters is wide enough that the
 * exact cutoff barely matters - it is set nearer the good cluster's side of
 * the gap only because this warns rather than suppresses.
 *
 * Raise it if a genuine regional-warehouse fulfilment ever gets flagged; that
 * is the expected false-positive shape, since Reliance Retail does ship some
 * categories from regional DCs rather than from a local store.
 */
const MAX_PLAUSIBLE_FULFILMENT_KM = 150;

/**
 * Reliance Digital's anonymous inventory API returns a specific fulfilling
 * store + quantity for a "deliverable" offer, but that allocation is never
 * verified against real stock until checkout (behind login) - see the
 * "KNOWN LIMIT - PHANTOM STORE STOCK" comment on relianceDigitalTarget in
 * targets.ts. Live evidence 2026-07-16: the SAME store uid (and frozen
 * quantity) came back as the fulfilling store for BOTH Bangalore (560075)
 * and Hyderabad (500032) for two different SKUs - one console can't
 * physically ship from a single store to two cities ~570km apart, so that
 * offer isn't real per-pincode stock.
 *
 * Two independent rules run over each cycle's IN_STOCK results, and a target
 * flagged by both gets both reasons:
 *
 *   1. STORE DISTANCE (per result). Measures the offer's own `long_lat`
 *      against the coordinates of the pincode that was asked about, and flags
 *      anything beyond MAX_PLAUSIBLE_FULFILMENT_KM. Added 2026-08-07.
 *   2. CROSS-PINCODE STORE REUSE (per SKU). Groups IN_STOCK results by
 *      fulfilling store uid and flags a store that fulfils 2+ pincodes whose
 *      first-two-digit postal-circle prefix differs - a cheap, deliberately
 *      conservative proxy for "not plausibly the same regional store".
 *
 * WHY RULE 1 EXISTS, given rule 2 already did: rule 2 can only ever fire by
 * comparing two pincodes against each other, so it is structurally dead
 * whenever only ONE pincode has relianceDigital enabled - which is the
 * current state of data/pincodes.json (560001 alone). Rule 1 needs only the
 * single result it is looking at, so the phantom guard now works at the
 * smallest possible configuration instead of quietly doing nothing. It also
 * catches the case rule 2 cannot see at any scale: a store that is far from
 * EVERY tracked pincode fulfils each of them "consistently" and so never
 * looks contradictory to rule 2.
 *
 * KNOWN LIMIT of rule 2's heuristic: some genuinely distant cities share a
 * postal prefix (e.g. Lucknow 22 / Varanasi 22, ~300km apart) and won't be
 * caught by it - it only flags when prefixes DIFFER, so it under-flags rather
 * than risks suppressing a real alert. Rule 1 covers that case directly.
 *
 * Neither rule changes `status`: a flagged result still counts as IN_STOCK for
 * state tracking and still fires its alert, just with the downgraded
 * "SUSPECTED STOCK (unconfirmed)" framing (see notifier.ts). That matches this
 * codebase's existing preference for the safe read when unsure - here the safe
 * read is "still tell the human, but don't let them trust it" rather than
 * silently withholding what might be a real restock.
 */
export function detectPhantomStock(results: StockResult[], pincodeEntries: PincodeEntry[]): Map<string, string> {
  const reasonsByTarget = new Map<string, string[]>();
  const addReason = (targetId: string, reason: string): void => {
    const existing = reasonsByTarget.get(targetId) ?? [];
    existing.push(reason);
    reasonsByTarget.set(targetId, existing);
  };

  const coordsByPincode = new Map<string, Coords>();
  for (const entry of pincodeEntries) {
    if (typeof entry.lat === "number" && typeof entry.lon === "number") {
      coordsByPincode.set(entry.pincode, { lat: entry.lat, lon: entry.lon });
    }
  }

  const bySkuAndStore = new Map<string, { pincode: string; targetId: string }[]>();
  // Pincodes whose distance rule couldn't run, deduped - reported once at the
  // end rather than per target, so a coordinate gap is visible in the log
  // instead of the guard just silently not applying.
  const missingCoords = new Set<string>();

  for (const r of results) {
    if (r.status !== "IN_STOCK") continue;
    const parsed = parseRdTargetId(r.target.id);
    const store = parseStoreDetail(r.detail);
    if (!parsed || !store) continue;

    // --- Rule 1: how far is the fulfilling store from the pincode asked about?
    const pincodeCoords = coordsByPincode.get(parsed.pincode);
    const storeCoords = parseLongLat(r.context?.long_lat);
    if (!pincodeCoords || !storeCoords) {
      missingCoords.add(parsed.pincode);
    } else {
      const distanceKm = haversineKm(pincodeCoords, storeCoords);
      if (distanceKm > MAX_PLAUSIBLE_FULFILMENT_KM) {
        addReason(
          r.target.id,
          `Fulfilling store "${store.name}" (uid ${store.uid}) is ~${Math.round(distanceKm)}km from pincode ` +
            `${parsed.pincode} - too far to be that pincode's local store, so this offer is likely a stale/phantom ` +
            `allocation that fails at payment. Treat as unconfirmed unless it reads as a regional warehouse.`
        );
      }
    }

    // --- Rule 2: is one store fulfilling pincodes in different postal circles?
    const key = `${parsed.skuKey}::${store.uid}`;
    const entries = bySkuAndStore.get(key) ?? [];
    entries.push({ pincode: parsed.pincode, targetId: r.target.id });
    bySkuAndStore.set(key, entries);
  }

  for (const [key, entries] of bySkuAndStore) {
    const prefixes = new Set(entries.map((e) => e.pincode.slice(0, 2)));
    if (prefixes.size <= 1) continue;

    const storeUid = key.split("::")[1];
    for (const entry of entries) {
      const otherPincodes = entries
        .filter((e) => e.targetId !== entry.targetId)
        .map((e) => e.pincode)
        .join(", ");
      addReason(
        entry.targetId,
        `Same fulfilling store (uid ${storeUid}) was also returned for pincode(s) ${otherPincodes} this cycle - ` +
          `too far apart to plausibly be the same real store, likely a stale/phantom allocation.`
      );
    }
  }

  if (missingCoords.size > 0) {
    logger.warn("Phantom store-distance check skipped - no usable coordinates", {
      pincodes: [...missingCoords].join(", "),
      hint: "run `npm run resolve-latlon` if a pincode row is missing lat/lon",
    });
  }

  const warnings = new Map<string, string>();
  for (const [targetId, reasons] of reasonsByTarget) {
    warnings.set(targetId, reasons.join(" "));
  }
  return warnings;
}
