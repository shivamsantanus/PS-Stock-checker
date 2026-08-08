import { config } from "./config";
import { ALL_TARGETS, TARGETS } from "./targets";
import { PLATFORMS, loadPlatformSwitchesSync } from "./platformStore";
import { logger } from "./logger";
import { StateManager } from "./stateManager";
import { StockChecker } from "./scraper";
import { hasAnyChannelConfigured, notifyBackInStock, notifyComingSoon, notifyError } from "./notifier";
import { detectPhantomStock } from "./phantomDetection";
import { loadPincodeEntriesSync } from "./pincodeStore";
import { StockResult, Target } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Fires the back-in-stock/coming-soon alerts and persists state for one already-checked result. */
async function handleCheckResult(state: StateManager, target: Target, result: StockResult): Promise<void> {
  if (result.error) {
    // Log and move on - a single broken selector/endpoint should never take
    // down the whole loop.
    logger.warn(`Skipping state update for "${target.id}" due to check error`, { error: result.error });
    return;
  }

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

/** Runs one full pass over every target, sequentially, with human-ish pacing. */
async function runCheckCycle(checker: StockChecker, state: StateManager): Promise<void> {
  logger.info(`Starting check cycle over ${TARGETS.length} target(s)`);

  // Reliance Digital's anonymous inventory API can return a fulfilling store
  // that isn't real per-pincode stock (see the "KNOWN LIMIT - PHANTOM STORE
  // STOCK" comment on relianceDigitalTarget in targets.ts) - so its targets
  // are checked as one batch FIRST, and detectPhantomStock cross-references
  // every result's fulfilling store across pincodes before any alert fires,
  // instead of alerting on each in isolation as it's checked.
  const rdTargets = TARGETS.filter((t) => t.id.startsWith("reliancedigital-"));
  const otherTargets = TARGETS.filter((t) => !t.id.startsWith("reliancedigital-"));

  const rdResults: StockResult[] = [];
  for (const target of rdTargets) {
    rdResults.push(await checker.check(target));
    const delay = randomBetween(config.minDelayBetweenTargetsMs, config.maxDelayBetweenTargetsMs);
    await sleep(delay);
  }

  // Read the pincode file fresh here rather than reusing a value captured at
  // startup: detectPhantomStock needs each pincode's coordinates to measure
  // how far the fulfilling store is, and a stale copy would silently disable
  // the distance rule for any row whose lat/lon was filled in by
  // `npm run resolve-latlon` while this process was running.
  const phantomWarnings = detectPhantomStock(rdResults, loadPincodeEntriesSync());
  for (const result of rdResults) {
    result.phantomWarning = phantomWarnings.get(result.target.id);
    await handleCheckResult(state, result.target, result);
  }

  for (const target of otherTargets) {
    const result = await checker.check(target);
    await handleCheckResult(state, target, result);

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

  // Log which stores are switched off in data/platforms.json (manage them with
  // `npm run admin`). Without this line a switched-off store is invisible in
  // the logs - the run just quietly never mentions it - which is exactly the
  // wrong way to find out why a restock went unalerted.
  const switches = loadPlatformSwitchesSync();
  const disabled = PLATFORMS.filter((p) => !switches[p.id]);
  if (disabled.length > 0) {
    logger.warn(`${disabled.length} store(s) switched OFF, not being checked`, {
      off: disabled.map((p) => p.label).join(", "),
      skippedTargets: ALL_TARGETS.length - TARGETS.length,
    });
  }

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
