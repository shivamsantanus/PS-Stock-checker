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
  // by Blinkit on its SECOND sweep. The 28 hot targets are only 2 distinct
  // product endpoints (one per SKU) fetched 14 times each with different
  // lat/lon headers, so a sweep lands 14 hits on the same URL within seconds
  // - which is what trips the limit, not the target count itself. 60s at
  // concurrency 2 keeps the sustained rate near 0.5 req/s.
  hotIntervalSeconds: optionalInt("HOT_INTERVAL_SECONDS", 60),
  coldIntervalMinutes: optionalInt("COLD_INTERVAL_MINUTES", 5),
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
  // this ceiling) and only resets after a clean sweep - so a rate-limit spike
  // backs off instead of hammering through it.
  hotBackoffMaxSeconds: optionalInt("HOT_BACKOFF_MAX_SECONDS", 600),

  // When true, run a single check cycle and exit instead of looping forever.
  // Used when the scheduling itself is external (e.g. a GitHub Actions cron).
  runOnce: optionalBool("RUN_ONCE", false),

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

  logLevel: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",

  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
