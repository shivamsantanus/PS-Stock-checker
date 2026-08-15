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

/**
 * Runs `fn` over `items` with at most `limit` in flight. Results keep input
 * order. Used for the hot tier only - see config.hotConcurrency for why the
 * limit is deliberately small rather than "all of them at once".
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Round-robins targets across platforms, so a concurrent sweep spreads its
 * in-flight requests over different retailers instead of hitting one of them
 * N times at once. Matters most for Zepto, which is more than half the cold
 * tier and sits behind AWS WAF.
 */
function interleaveByPlatform(targets: Target[]): Target[] {
  const queues = new Map<string, Target[]>();
  for (const t of targets) {
    const queue = queues.get(t.platform);
    if (queue) queue.push(t);
    else queues.set(t.platform, [t]);
  }

  const out: Target[] = [];
  const lists = [...queues.values()];
  for (let i = 0; out.length < targets.length; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/**
 * Fires the back-in-stock/coming-soon alerts and persists state for one
 * already-checked result. Returns true when this result represents a NEW
 * IN_STOCK or COMING_SOON transition - the hot tier uses that to escalate
 * (see Controller.requestColdSweep).
 */
async function handleCheckResult(state: StateManager, target: Target, result: StockResult): Promise<boolean> {
  if (result.error) {
    // Log and move on - a single broken selector/endpoint should never take
    // down the whole loop.
    logger.warn(`Skipping state update for "${target.id}" due to check error`, { error: result.error });
    return false;
  }

  const previousStatus = state.getPreviousStatus(target.id);
  logger.info(`Checked "${target.id}"`, {
    status: result.status,
    previousStatus,
    detail: result.detail,
    // Which dark store the read applies to - the single most useful field when
    // someone reports "it alerted but there was nothing there".
    ...(result.resolvedLocation ? { store: result.resolvedLocation } : {}),
  });

  const justCameInStock = previousStatus !== "IN_STOCK" && result.status === "IN_STOCK";
  if (justCameInStock) {
    await notifyBackInStock(result);
  }

  const justBecameComingSoon = previousStatus !== "COMING_SOON" && result.status === "COMING_SOON";
  if (justBecameComingSoon) {
    await notifyComingSoon(result);
  }

  await state.recordCheck(target.id, result.status);
  return justCameInStock || justBecameComingSoon;
}

// Targets are tiered by check cost, not by platform - see the tiered-polling
// block in config.ts. "browser-api" is one fetch on an already-open page;
// everything else is a full render or a batched cross-pincode pass.
const HOT_TARGETS = TARGETS.filter((t) => t.strategy === "browser-api");
const COLD_TARGETS = TARGETS.filter((t) => t.strategy !== "browser-api");

/**
 * The cheap tier: every browser-api target, checked concurrently. Returns
 * true if any target newly went IN_STOCK/COMING_SOON, so the caller can pull
 * the cold sweep forward instead of waiting out its interval.
 */
async function runHotSweep(
  checker: StockChecker,
  state: StateManager
): Promise<{ changed: boolean; rateLimited: boolean }> {
  const startedAt = Date.now();
  let rateLimitedCount = 0;

  const escalations = await mapWithConcurrency(HOT_TARGETS, config.hotConcurrency, async (target) => {
    // Per-request jitter so a sweep doesn't leave a perfectly uniform,
    // obviously-scripted request pattern in Blinkit's logs.
    await sleep(randomBetween(0, config.hotRequestJitterMs));
    const result = await checker.check(target);
    if (result.error?.includes("HTTP 429")) rateLimitedCount++;
    return handleCheckResult(state, target, result);
  });

  const changed = escalations.some(Boolean);
  // A handful of 429s is noise; a sweep that is mostly rate-limited means the
  // current cadence is over Blinkit's tolerance and must back off.
  const rateLimited = rateLimitedCount > HOT_TARGETS.length / 4;

  logger.info("Hot sweep complete", {
    targets: HOT_TARGETS.length,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    rateLimited: rateLimitedCount,
    escalating: changed,
  });
  return { changed, rateLimited };
}

/**
 * The expensive tier: DOM renders plus the batched Reliance Digital pass.
 *
 * Reliance Digital's anonymous inventory API can return a fulfilling store
 * that isn't real per-pincode stock (see the "KNOWN LIMIT - PHANTOM STORE
 * STOCK" comment on relianceDigitalTarget in targets.ts) - so its targets are
 * checked as one batch FIRST, and detectPhantomStock cross-references every
 * result's fulfilling store before any alert fires, instead of alerting on
 * each in isolation as it's checked.
 */
async function runColdSweep(checker: StockChecker, state: StateManager): Promise<void> {
  const startedAt = Date.now();

  const rdTargets = COLD_TARGETS.filter((t) => t.id.startsWith("reliancedigital-"));
  const otherTargets = COLD_TARGETS.filter((t) => !t.id.startsWith("reliancedigital-"));

  const rdResults: StockResult[] = [];
  for (const target of rdTargets) {
    rdResults.push(await checker.check(target));
    await sleep(randomBetween(config.minDelayBetweenTargetsMs, config.maxDelayBetweenTargetsMs));
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

  await mapWithConcurrency(interleaveByPlatform(otherTargets), config.coldConcurrency, async (target) => {
    // Small randomized pause before each check so requests don't fire in a
    // suspiciously uniform burst.
    await sleep(randomBetween(config.minDelayBetweenTargetsMs, config.maxDelayBetweenTargetsMs));
    const result = await checker.check(target);
    await handleCheckResult(state, target, result);
  });

  logger.info("Cold sweep complete", {
    targets: COLD_TARGETS.length,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

/**
 * Shared shutdown flag plus the escalation signal between the two loops.
 *
 * The tiers run as genuinely concurrent loops rather than one interleaved
 * cycle, because a cold sweep takes minutes (16 DOM renders) and would
 * otherwise stall the 30-second hot tier behind it every time it ran.
 */
class Controller {
  shuttingDown = false;
  private wakeCold: (() => void) | null = null;

  /** Pulls the next cold sweep forward - called when the hot tier sees a change. */
  requestColdSweep(): void {
    this.wakeCold?.();
  }

  /** Sleeps until `ms` elapses, shutdown begins, or a cold sweep is requested. */
  waitForCold(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.wakeCold = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      // Node keeps the process alive for a pending timer; this one is a
      // plain wait, so let it not block a clean exit.
      timer.unref?.();
      this.wakeCold = finish;
    });
  }
}

async function hotLoop(checker: StockChecker, state: StateManager, ctl: Controller): Promise<void> {
  // Doubles on a rate-limited sweep, halves back down only after a run of
  // clean ones - see hotBackoffMaxSeconds / hotRecoveryCleanSweeps.
  let intervalSeconds = config.hotIntervalSeconds;
  let cleanSweeps = 0;
  // Ratchets up every time a given rate proves too fast, and recovery never
  // steps below it. Without this the loop cannot converge: halving always
  // walks back to the configured base, and if THAT base is what the IP
  // rejects, it just re-trips forever (verified by simulation - the observed
  // 60->120->60 sawtooth becomes 90->180->180->90 rather than settling).
  // Remembering the failed rate, plus a margin, lets the interval climb until
  // it finds a level this connection actually tolerates and then stay there.
  let floorSeconds = config.hotIntervalSeconds;

  while (!ctl.shuttingDown) {
    try {
      const { changed, rateLimited } = await runHotSweep(checker, state);

      if (rateLimited) {
        cleanSweeps = 0;
        // This rate is now known-bad, so never recover back down to it.
        floorSeconds = Math.min(
          Math.max(floorSeconds, Math.round(intervalSeconds * 1.25)),
          config.hotBackoffMaxSeconds
        );
        intervalSeconds = Math.min(intervalSeconds * 2, config.hotBackoffMaxSeconds);
        logger.warn("Hot tier is being rate-limited, backing off", {
          nextIntervalSeconds: intervalSeconds,
          floorSeconds,
        });
      } else if (intervalSeconds > floorSeconds) {
        cleanSweeps++;
        if (cleanSweeps >= config.hotRecoveryCleanSweeps) {
          cleanSweeps = 0;
          intervalSeconds = Math.max(Math.round(intervalSeconds / 2), floorSeconds);
          logger.info("Hot tier steady, easing the interval back down", {
            nextIntervalSeconds: intervalSeconds,
            floorSeconds,
          });
        }
      }

      if (changed) {
        // Something moved. Check the expensive tier right now rather than
        // waiting out its interval - a restock often lands across several
        // retailers within the same few minutes.
        logger.info("Hot tier saw a change, pulling the cold sweep forward");
        ctl.requestColdSweep();
      }
    } catch (err: any) {
      logger.error("Unhandled error during hot sweep", { error: err.message });
      await notifyError(`hot sweep: ${err.message}`);
    }

    if (ctl.shuttingDown) break;
    // Jitter is a share of THIS interval, so it can never swallow the whole
    // gap and fire two sweeps back to back (which is what drew the 429s).
    const jitterMs = (intervalSeconds * 1000 * config.hotJitterPercent) / 100;
    await sleep(Math.max(1000, intervalSeconds * 1000 + randomBetween(-jitterMs, jitterMs)));
  }
}

async function coldLoop(checker: StockChecker, state: StateManager, ctl: Controller): Promise<void> {
  while (!ctl.shuttingDown) {
    try {
      await runColdSweep(checker, state);
    } catch (err: any) {
      logger.error("Unhandled error during cold sweep", { error: err.message });
      await notifyError(`cold sweep: ${err.message}`);
    }

    if (ctl.shuttingDown) break;
    await ctl.waitForCold(config.coldIntervalMinutes * 60_000);
  }
}

async function main(): Promise<void> {
  if (!hasAnyChannelConfigured()) {
    throw new Error(
      "No notification channel configured - set DISCORD_WEBHOOK_URL and/or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env"
    );
  }

  const state = new StateManager();
  const checker = new StockChecker();
  const ctl = new Controller();

  await state.load();
  await checker.init();

  const shutdown = async (signal: string) => {
    if (ctl.shuttingDown) return;
    ctl.shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    // Releases coldLoop from its interval wait so it can observe the flag.
    ctl.requestColdSweep();
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
    hotTargets: HOT_TARGETS.length,
    hotIntervalSeconds: config.hotIntervalSeconds,
    hotConcurrency: config.hotConcurrency,
    coldTargets: COLD_TARGETS.length,
    coldIntervalMinutes: config.coldIntervalMinutes,
  });

  // RUN_ONCE keeps the GitHub Actions path working: one sweep of each tier,
  // then exit, with no interval waits.
  if (config.runOnce) {
    await runHotSweep(checker, state);
    await runColdSweep(checker, state);
    logger.info("RUN_ONCE is set, exiting after a single sweep of each tier");
    await checker.close();
    return;
  }

  await Promise.all([hotLoop(checker, state, ctl), coldLoop(checker, state, ctl)]);

  if (!ctl.shuttingDown) {
    await checker.close();
  }
}

main().catch((err) => {
  logger.error("Fatal error, exiting", { error: err.message });
  process.exit(1);
});
