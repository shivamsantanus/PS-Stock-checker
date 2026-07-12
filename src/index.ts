import { config } from "./config";
import { TARGETS } from "./targets";
import { logger } from "./logger";
import { StateManager } from "./stateManager";
import { StockChecker } from "./scraper";
import { hasAnyChannelConfigured, notifyBackInStock, notifyComingSoon, notifyError } from "./notifier";
import { StockResult } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Runs one full pass over every target, sequentially, with human-ish pacing. */
async function runCheckCycle(checker: StockChecker, state: StateManager): Promise<void> {
  logger.info(`Starting check cycle over ${TARGETS.length} target(s)`);

  for (const target of TARGETS) {
    const result: StockResult = await checker.check(target);

    if (result.error) {
      // Log and move on - a single broken selector/endpoint should never
      // take down the whole loop.
      logger.warn(`Skipping state update for "${target.id}" due to check error`, {
        error: result.error,
      });
    } else {
      const previousStatus = state.getPreviousStatus(target.id);
      logger.info(`Checked "${target.id}"`, { status: result.status, previousStatus, detail: result.detail });

      const justCameInStock = previousStatus !== "IN_STOCK" && result.status === "IN_STOCK";
      if (justCameInStock) {
        await notifyBackInStock(result);
      }

      const justBecameComingSoon = previousStatus !== "COMING_SOON" && result.status === "COMING_SOON";
      if (justBecameComingSoon) {
        await notifyComingSoon(result);
      }

      await state.recordCheck(target.id, result.status);
    }

    // Small randomized pause between hitting different targets so requests
    // don't fire in a suspiciously uniform burst.
    const delay = randomBetween(config.minDelayBetweenTargetsMs, config.maxDelayBetweenTargetsMs);
    await sleep(delay);
  }

  logger.info("Check cycle complete");
}

/** Computes the next wait time: base interval +/- configured jitter. */
function nextIntervalMs(): number {
  const baseMs = config.checkIntervalMinutes * 60_000;
  const jitterMs = config.jitterSeconds * 1_000;
  const offset = randomBetween(-jitterMs, jitterMs);
  return Math.max(0, baseMs + offset);
}

async function main(): Promise<void> {
  if (!hasAnyChannelConfigured()) {
    throw new Error(
      "No notification channel configured - set DISCORD_WEBHOOK_URL and/or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env"
    );
  }

  const state = new StateManager();
  const checker = new StockChecker();

  await state.load();
  await checker.init();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await checker.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("Stock checker started", {
    targets: TARGETS.length,
    intervalMinutes: config.checkIntervalMinutes,
    jitterSeconds: config.jitterSeconds,
  });

  while (!shuttingDown) {
    try {
      await runCheckCycle(checker, state);
    } catch (err: any) {
      // Catch-all so an unexpected failure (e.g. browser crash) doesn't
      // kill the whole process - log it, alert, and keep looping.
      logger.error("Unhandled error during check cycle", { error: err.message });
      await notifyError(err.message);
    }

    if (shuttingDown) break;

    if (config.runOnce) {
      logger.info("RUN_ONCE is set, exiting after a single cycle");
      break;
    }

    const waitMs = nextIntervalMs();
    logger.info(`Sleeping for ${Math.round(waitMs / 1000)}s until next cycle`);
    await sleep(waitMs);
  }

  if (!shuttingDown) {
    await checker.close();
  }
}

main().catch((err) => {
  logger.error("Fatal error, exiting", { error: err.message });
  process.exit(1);
});
