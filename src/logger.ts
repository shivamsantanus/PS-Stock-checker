import { config } from "./config";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

function shouldLog(level: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(config.logLevel);
}

function timestamp(): string {
  return new Date().toISOString();
}

function emit(level: Level, message: string, meta?: unknown): void {
  if (!shouldLog(level)) return;
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  const line = meta !== undefined ? `${prefix} ${message} ${JSON.stringify(meta)}` : `${prefix} ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit("debug", message, meta),
  info: (message: string, meta?: unknown) => emit("info", message, meta),
  warn: (message: string, meta?: unknown) => emit("warn", message, meta),
  error: (message: string, meta?: unknown) => emit("error", message, meta),
};
