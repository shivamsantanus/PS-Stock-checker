import { Browser, BrowserContext, chromium } from "playwright";
import axios from "axios";
import { config } from "./config";
import { logger } from "./logger";
import { StockResult, StockStatus, Target } from "./types";

const COMMON_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

function matchesInStock(text: string, inStockValues: string[]): boolean {
  const normalized = text.toLowerCase();
  return inStockValues.some((v) => normalized.includes(v.toLowerCase()));
}

/** Resolves a dot-path like "a.b.c" against a parsed JSON object. */
function resolveJsonPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Owns a single shared Playwright browser instance for the whole run so we
 * don't pay browser-launch cost on every target/cycle. Call close() on
 * shutdown.
 */
export class StockChecker {
  private browser: Browser | null = null;

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.headless });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  async check(target: Target): Promise<StockResult> {
    const checkedAt = new Date().toISOString();
    try {
      const status =
        target.strategy === "dom" ? await this.checkDom(target) : await this.checkApi(target);
      return { target, status: status.status, checkedAt, detail: status.detail };
    } catch (err: any) {
      logger.error(`Check failed for target "${target.id}"`, { error: err.message });
      return { target, status: "UNKNOWN", checkedAt, error: err.message };
    }
  }

  private async checkDom(target: Target): Promise<{ status: StockStatus; detail: string }> {
    if (!this.browser) throw new Error("Browser not initialized - call init() first");
    if (!target.selector) throw new Error(`Target "${target.id}" uses "dom" strategy but has no selector`);

    let context: BrowserContext | null = null;
    try {
      context = await this.browser.newContext({
        userAgent: config.userAgent,
        locale: "en-US",
        extraHTTPHeaders: COMMON_HEADERS,
      });
      const page = await context.newPage();

      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: config.requestTimeoutMs,
      });

      // Wait specifically for the availability element rather than a fixed
      // sleep - this is both faster on average and more resilient to
      // variable page load times.
      await page.waitForSelector(target.selector, { timeout: config.requestTimeoutMs });

      const rawText = (await page.locator(target.selector).first().innerText()).trim();
      const status: StockStatus = matchesInStock(rawText, target.inStockValues)
        ? "IN_STOCK"
        : "OUT_OF_STOCK";

      return { status, detail: rawText };
    } finally {
      await context?.close();
    }
  }

  private async checkApi(target: Target): Promise<{ status: StockStatus; detail: string }> {
    if (!target.jsonPath) throw new Error(`Target "${target.id}" uses "api" strategy but has no jsonPath`);

    const response = await axios.get(target.url, {
      timeout: config.requestTimeoutMs,
      headers: {
        "User-Agent": config.userAgent,
        ...COMMON_HEADERS,
      },
    });

    const value = resolveJsonPath(response.data, target.jsonPath);
    if (value === undefined) {
      throw new Error(`jsonPath "${target.jsonPath}" not found in response for target "${target.id}"`);
    }

    const rawText = String(value);
    const status: StockStatus = matchesInStock(rawText, target.inStockValues)
      ? "IN_STOCK"
      : "OUT_OF_STOCK";

    return { status, detail: rawText };
  }
}
