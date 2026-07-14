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

  logLevel: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",

  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
