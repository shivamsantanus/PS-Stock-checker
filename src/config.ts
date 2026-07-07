import dotenv from "dotenv";
import path from "path";

dotenv.config();

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
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
  telegramChatId: optionalEnv("TELEGRAM_CHAT_ID"),

  checkIntervalMinutes: optionalInt("CHECK_INTERVAL_MINUTES", 10),
  jitterSeconds: optionalInt("JITTER_SECONDS", 30),

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
