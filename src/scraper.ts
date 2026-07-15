import { Browser, BrowserContext, Page, chromium } from "playwright";
import axios from "axios";
import { config } from "./config";
import { logger } from "./logger";
import { InStockConfirmation, StockResult, StockStatus, Target } from "./types";

const COMMON_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

function containsAny(text: string, values: string[]): boolean {
  const normalized = text.toLowerCase();
  return values.some((v) => normalized.includes(v.toLowerCase()));
}

/**
 * comingSoonValues, then outOfStockValues, are checked before inStockValues:
 * an explicit "Coming soon"/"Out Of Stock"/"Notify Me" marker is usually a
 * more reliable signal on a busy page than the mere presence of "add to
 * cart" text, which can come from an unrelated recommendation carousel.
 * Falls back to OUT_OF_STOCK if nothing matches - an inconclusive read
 * should never look "in stock".
 */
function resolveStatus(text: string, target: Target): StockStatus {
  if (target.comingSoonValues && containsAny(text, target.comingSoonValues)) {
    return "COMING_SOON";
  }
  if (target.outOfStockValues && containsAny(text, target.outOfStockValues)) {
    return "OUT_OF_STOCK";
  }
  return containsAny(text, target.inStockValues) ? "IN_STOCK" : "OUT_OF_STOCK";
}

/**
 * Reads an element's visible text (innerText, falling back to textContent for
 * non-rendered nodes), or "" if the selector isn't present. Never throws - a
 * missing confirmation element should fail the guard, not crash the check.
 */
async function readSelectorText(page: Page, selector: string): Promise<string> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return "";
  let text = (await locator.innerText().catch(() => "")).trim();
  if (!text) {
    text = ((await locator.textContent().catch(() => "")) ?? "").trim();
  }
  return text;
}

/**
 * Returns null if every confirmation holds (in-stock read is trustworthy),
 * or a short human-readable reason string for the first one that fails.
 * See InStockConfirmation for why this guard exists.
 */
async function failedInStockConfirmation(
  page: Page,
  confirmations: InStockConfirmation[]
): Promise<string | null> {
  for (const c of confirmations) {
    const text = await readSelectorText(page, c.selector);
    if (c.matches) {
      // Case-insensitive; `matches` is a trusted, hand-written pattern from
      // targets.ts (not user input), so building a RegExp from it is safe.
      if (!new RegExp(c.matches, "i").test(text)) {
        return `"${c.selector}" text ${JSON.stringify(text.slice(0, 60))} did not match /${c.matches}/i`;
      }
    }
    if (c.rejectAny && containsAny(text, c.rejectAny)) {
      return `"${c.selector}" text ${JSON.stringify(text.slice(0, 60))} contained a rejected value`;
    }
  }
  return null;
}

/**
 * Resolves a dot-path like "a.b.c" against a parsed JSON object. The special
 * path "$" returns the whole response - for APIs whose availability signal
 * is "the response has content at all" (e.g. Reliance Digital's per-pincode
 * article endpoint returns a full seller offer when deliverable and a bare
 * `{}` when not - there is no stable inner key to point at in both cases).
 */
function resolveJsonPath(obj: unknown, dotPath: string): unknown {
  if (dotPath === "$") return obj;
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

      if (target.cookies?.length) {
        await context.addCookies(target.cookies.map((c) => ({ ...c, path: c.path ?? "/" })));
      }

      const page = await context.newPage();

      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: config.requestTimeoutMs,
      });

      // Sites that gate availability behind a delivery pincode/address picker
      // (most quick-commerce apps) need that picker driven before the real
      // stock selector shows up.
      for (const step of target.preActions ?? []) {
        if (step.action === "fill") {
          await page.fill(step.selector, step.value ?? "");
        } else if (step.action === "press") {
          await page.press(step.selector, step.value ?? "Enter");
        } else {
          await page.click(step.selector);
        }
        if (step.waitAfterMs) {
          await page.waitForTimeout(step.waitAfterMs);
        }
      }

      // Wait specifically for the availability element rather than a fixed
      // sleep - this is both faster on average and more resilient to
      // variable page load times. state: "attached" (not the default
      // "visible") because some selectors deliberately target non-rendered
      // elements like <script type="application/ld+json">.
      await page.waitForSelector(target.selector, { timeout: config.requestTimeoutMs, state: "attached" });

      // innerText first: for normal visible elements it correctly excludes
      // nested non-rendered nodes (e.g. an inline <script> that happens to
      // be a descendant), which textContent would otherwise pull in as
      // noise. Only fall back to textContent when innerText is empty - that
      // happens for selectors that are themselves non-rendered, like a
      // <script type="application/ld+json"> block used to read structured
      // data (a more stable signal than visual, freely-changing markup).
      const locator = page.locator(target.selector).first();
      let rawText = (await locator.innerText().catch(() => "")).trim();
      if (!rawText) {
        rawText = ((await locator.textContent()) ?? "").trim();
      }

      const status = resolveStatus(rawText, target);

      // An IN_STOCK read on a pincode-gated site is only trusted once we can
      // positively confirm a real serviceable delivery store resolved - see
      // InStockConfirmation. If we can't, downgrade to UNKNOWN so no false
      // "back in stock" alert fires (rather than believing the default
      // no-location "Add to Cart" view).
      if (status === "IN_STOCK" && target.inStockConfirmations?.length) {
        const reason = await failedInStockConfirmation(page, target.inStockConfirmations);
        if (reason) {
          logger.warn(`Discarding unconfirmed IN_STOCK read for "${target.id}"`, { reason });
          return { status: "UNKNOWN", detail: `unconfirmed in-stock: ${reason}` };
        }
      }

      return { status, detail: rawText };
    } finally {
      await context?.close();
    }
  }

  private async checkApi(target: Target): Promise<{ status: StockStatus; detail: string }> {
    if (!target.jsonPath) throw new Error(`Target "${target.id}" uses "api" strategy but has no jsonPath`);

    const response = await axios.request({
      url: target.url,
      method: target.method ?? "GET",
      data: target.requestBody,
      timeout: config.requestTimeoutMs,
      headers: {
        "User-Agent": config.userAgent,
        ...COMMON_HEADERS,
        // Target-specific headers last so they can override the defaults
        // (e.g. Accept: application/json for a JSON storefront API).
        ...target.requestHeaders,
      },
    });

    const value = resolveJsonPath(response.data, target.jsonPath);
    if (value === undefined) {
      throw new Error(`jsonPath "${target.jsonPath}" not found in response for target "${target.id}"`);
    }

    // Objects/arrays are matched against their JSON text: an availability
    // signal is sometimes structural rather than a scalar - e.g. Croma's
    // delivery-promise response, where in-stock means the promiseLine array
    // has entries and out-of-stock means an unavailableReason appears.
    const rawText = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
    return { status: resolveStatus(rawText, target), detail: rawText.slice(0, 300) };
  }
}
