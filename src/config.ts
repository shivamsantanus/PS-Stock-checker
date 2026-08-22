import dotenv from "dotenv";
import path from "path";

dotenv.config();

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Parses a comma-separated env var into a list of trimmed, non-empty values.
 * Lets a single TELEGRAM_CHAT_ID setting fan a notification out to several
 * chats at once (e.g. a private chat AND a group).
 */
function optionalList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true";
}

export const config = {
  // Both notification channels are optional individually, but at least one
  // must be configured - validated at startup in index.ts.
  discordWebhookUrl: optionalEnv("DISCORD_WEBHOOK_URL"),
  telegramBotToken: optionalEnv("TELEGRAM_BOT_TOKEN"),
  // Accepts one ID or a comma-separated list, so a single alert can be
  // delivered to multiple chats (e.g. "1933043199,-5469712170").
  telegramChatIds: optionalList("TELEGRAM_CHAT_ID"),

  checkIntervalMinutes: optionalInt("CHECK_INTERVAL_MINUTES", 10),
  jitterSeconds: optionalInt("JITTER_SECONDS", 30),

  // --- Tiered polling (see runHotSweep/runColdSweep in index.ts) ---------
  // Targets are split by how expensive they are to check, not by platform:
  // the "hot" tier is every browser-api target (one fetch on an already-open
  // page, no render), the "cold" tier is everything else (full page renders
  // and the batched Reliance Digital phantom pass). Polling them at one
  // shared interval meant the cheap checks were held back by the expensive
  // ones - a full 55-target sequential cycle spent ~3.7 minutes asleep before
  // any target got looked at twice.
  //
  // MEASURED 2026-08-08, and the reason these defaults are not more
  // aggressive: a 30s interval at concurrency 4 got the hot tier HTTP 429'd
  // by Blinkit on its SECOND sweep. The hot targets are only 2 distinct
  // product endpoints (one per SKU) fetched once per pincode with different
  // lat/lon headers, so a sweep lands N hits on the same URL within seconds
  // - which is what trips the limit, not the target count itself.
  //
  // 60 was the first value tried and is NOT enough. A second machine ran it
  // for ~8 minutes and settled into a sawtooth: 2-3 clean sweeps, then a
  // sweep with 11 of 32 rate-limited, back off, recover, trip again. Blinkit's
  // limit is per-IP and the tolerance differs per connection, so this default
  // is set above the highest rate BOTH observed machines sustained rather
  // than at the edge of the more permissive one. Lower it per-machine via the
  // env var if a given IP proves it can take more.
  hotIntervalSeconds: optionalInt("HOT_INTERVAL_SECONDS", 90),
  coldIntervalMinutes: optionalInt("COLD_INTERVAL_MINUTES", 5),
  // How many cold-tier checks may be in flight at once. Sequential, the cold
  // sweep runs ~13 minutes (50 DOM renders, most of them Zepto's scripted
  // location-picker waits) - longer than the CI job timeout, which is why
  // every scheduled run was being cancelled mid-cycle. Kept low because these
  // are full page renders: the sweep is interleaved across retailers (see
  // interleaveByPlatform) so a small number in flight still means roughly one
  // request per site at a time, not a burst at any single one.
  coldConcurrency: optionalInt("COLD_CONCURRENCY", 3),
  // How many hot-tier checks may be in flight at once. Deliberately small:
  // Blinkit sits behind Cloudflare bot management (see CheckStrategy in
  // types.ts), and firing many at once looks far more like a scraper than a
  // couple of overlapping requests do.
  hotConcurrency: optionalInt("HOT_CONCURRENCY", 2),
  // Jitter applied per hot-tier request so a sweep doesn't fire as a
  // perfectly uniform burst.
  hotRequestJitterMs: optionalInt("HOT_REQUEST_JITTER_MS", 800),
  // Hot-tier jitter is a PERCENTAGE of the hot interval, not the flat
  // jitterSeconds above: that value is sized for the 10-minute cold cadence,
  // and applying +/-30s to a 30s interval let two sweeps fire ~10s apart,
  // which is exactly how the 429 above was provoked.
  hotJitterPercent: optionalInt("HOT_JITTER_PERCENT", 20),
  // When a sweep comes back mostly rate-limited, the interval doubles (up to
  // this ceiling) so a rate-limit spike backs off instead of hammering
  // through it.
  hotBackoffMaxSeconds: optionalInt("HOT_BACKOFF_MAX_SECONDS", 600),
  // How many CONSECUTIVE clean sweeps are required before the interval steps
  // back down, and it halves rather than resetting outright.
  //
  // Backing off must be fast but recovering must not be: the first version
  // reset straight to the base interval after ONE clean sweep, which put it
  // back at the exact rate that had just been limited, and it re-tripped
  // within 2-3 sweeps. Observed live 2026-08-08 as a 60->120->60->120
  // sawtooth. Halving after two clean sweeps lets the interval settle on
  // whatever the current IP actually tolerates instead of oscillating around
  // it - and means a machine on a stricter connection self-tunes rather than
  // needing its own HOT_INTERVAL_SECONDS.
  hotRecoveryCleanSweeps: optionalInt("HOT_RECOVERY_CLEAN_SWEEPS", 2),

  // When true, run a single check cycle and exit instead of looping forever.
  // Used when the scheduling itself is external (e.g. a GitHub Actions cron).
  runOnce: optionalBool("RUN_ONCE", false),

  // When false, alerts are logged instead of sent. Use it to PRIME the state
  // file after the checker has been down: every entry older than
  // stateStaleAfterHours is treated as UNKNOWN, so the first sweep back would
  // otherwise fire an alert for every target that is merely still in stock -
  // a burst of stale notifications to a paying audience. Run one
  // NOTIFY_ENABLED=false RUN_ONCE=true sweep first, then start for real.
  notifyEnabled: optionalBool("NOTIFY_ENABLED", true),

  headless: optionalBool("HEADLESS", true),
  requestTimeoutMs: optionalInt("REQUEST_TIMEOUT_MS", 30_000),

  minDelayBetweenTargetsMs: optionalInt("MIN_DELAY_BETWEEN_TARGETS_MS", 2_000),
  maxDelayBetweenTargetsMs: optionalInt("MAX_DELAY_BETWEEN_TARGETS_MS", 6_000),

  stateFilePath: path.resolve(
    process.cwd(),
    process.env.STATE_FILE_PATH || "./data/state.json"
  ),

  // Screenshot + HTML dump saved here whenever a DOM check throws (e.g. a
  // pre-action selector never appears) - the only way to tell "site changed
  // its markup" apart from "got served a bot-detection/CAPTCHA page" without
  // eyeballing a live browser. CI uploads this directory as a build artifact.
  debugDir: path.resolve(process.cwd(), process.env.DEBUG_DIR || "./data/debug"),

  // How long a stored status stays believable - see getPreviousStatus.
  stateStaleAfterHours: optionalInt("STATE_STALE_AFTER_HOURS", 24),

  // --- Alert policy -------------------------------------------------------
  // These throttle what gets SENT. Nothing here changes how often targets are
  // checked, so a real restock is still detected on the normal cadence.
  //
  // The two alert kinds get deliberately opposite settings because they are
  // not the same kind of event:
  //
  //   IN_STOCK is a race - someone has to buy the thing before it sells out,
  //   and the Blinkit window on 2026-08-08 was shorter than ten minutes. It
  //   must therefore fire on the FIRST positive read (confirmations of 1);
  //   only a cooldown guards against a flapping listing machine-gunning the
  //   group.
  //
  //   COMING_SOON is an early warning - nothing is buyable, so arriving a
  //   couple of minutes later costs nothing. It can afford to wait for the
  //   status to hold, which kills flicker at the source instead of merely
  //   rate-limiting it.
  comingSoonConfirmations: optionalInt("COMING_SOON_CONFIRMATIONS", 2),
  comingSoonAlertCooldownMinutes: optionalInt("COMING_SOON_ALERT_COOLDOWN_MINUTES", 360),
  inStockAlertCooldownMinutes: optionalInt("IN_STOCK_ALERT_COOLDOWN_MINUTES", 20),

  logLevel: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",

  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
