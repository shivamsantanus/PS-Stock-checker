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
 * This flags exactly that pattern within a single check cycle: for each SKU,
 * group all IN_STOCK results by fulfilling store uid. If a store is the
 * fulfiller for 2+ pincodes whose first-two-digit postal-circle prefix
 * differs - a cheap, deliberately conservative proxy for "not plausibly the
 * same regional store" - every result in that group gets a warning string
 * to attach to its alert instead of being silently trusted.
 *
 * KNOWN LIMIT of the heuristic itself: some genuinely distant cities share a
 * postal prefix (e.g. Lucknow 22 / Varanasi 22, ~300km apart) and won't be
 * caught here - it only flags when prefixes DIFFER, so it under-flags rather
 * than risks suppressing a real alert. That's intentional: matches this
 * codebase's existing pattern of defaulting to the safe read when unsure
 * (see resolveStatus's OUT_OF_STOCK fallback in scraper.ts).
 */
export function detectPhantomStock(results: StockResult[]): Map<string, string> {
  const warnings = new Map<string, string>();

  const bySkuAndStore = new Map<string, { pincode: string; targetId: string }[]>();
  for (const r of results) {
    if (r.status !== "IN_STOCK") continue;
    const parsed = parseRdTargetId(r.target.id);
    const store = parseStoreDetail(r.detail);
    if (!parsed || !store) continue;

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
      warnings.set(
        entry.targetId,
        `Same fulfilling store (uid ${storeUid}) was also returned for pincode(s) ${otherPincodes} this cycle - ` +
          `too far apart to plausibly be the same real store, likely a stale/phantom allocation.`
      );
    }
  }

  return warnings;
}
