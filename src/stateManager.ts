import fs from "fs/promises";
import path from "path";
import { StateMap, StockStatus } from "./types";
import { config } from "./config";
import { logger } from "./logger";

/**
 * Persists last-known stock status per target to a local JSON file so that:
 *  - restarts don't cause a false "just changed" alert on the first check
 *  - we only fire a notification on an actual OUT_OF_STOCK -> IN_STOCK transition
 */
export class StateManager {
  private state: StateMap = {};
  private readonly filePath: string;
  // Tail of the serialized write chain - see persist().
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string = config.stateFilePath) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      this.state = JSON.parse(raw) as StateMap;
      logger.info("Loaded existing state file", { entries: Object.keys(this.state).length });
    } catch (err: any) {
      if (err.code === "ENOENT") {
        logger.info("No existing state file found, starting fresh");
        this.state = {};
      } else {
        logger.error("Failed to load state file, starting fresh", { error: err.message });
        this.state = {};
      }
    }
  }

  getPreviousStatus(targetId: string): StockStatus {
    return this.state[targetId]?.status ?? "UNKNOWN";
  }

  async recordCheck(targetId: string, status: StockStatus): Promise<void> {
    const now = new Date().toISOString();
    const previous = this.state[targetId];
    const changed = !previous || previous.status !== status;

    this.state[targetId] = {
      status,
      lastCheckedAt: now,
      lastChangedAt: changed ? now : previous.lastChangedAt,
    };

    await this.persist();
  }

  /**
   * Serializes every write onto a single chain. The tiered poller runs the hot
   * and cold sweeps as concurrent loops, and the hot sweep itself checks
   * several targets at once - so without this, multiple persists would race on
   * the SAME `${filePath}.tmp` path, and one call's rename could publish
   * another call's half-written bytes.
   *
   * The chain deliberately recovers from a rejected predecessor (the second
   * arm of `.then`): one failed write must not permanently wedge every
   * subsequent state update behind it.
   */
  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(
      () => this.writeNow(),
      () => this.writeNow()
    );
    return this.writeQueue;
  }

  private async writeNow(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write to a temp file then rename, so a crash mid-write never leaves
    // a truncated/corrupt state.json behind.
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    await fs.rename(tmpPath, this.filePath);
  }
}
