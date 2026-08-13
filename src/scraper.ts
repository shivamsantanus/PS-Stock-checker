import { Browser, BrowserContext, Page, chromium } from "playwright";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { config } from "./config";
import { logger } from "./logger";
import { InStockConfirmation, JsonFind, StockResult, StockStatus, Target } from "./types";

/**
 * Headers for the axios ("api") path only - a bare HTTP client sends nothing
 * browser-like on its own, so it has to spell these out.
 */
const COMMON_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * What a browser context may override - deliberately ONLY Accept-Language.
 *
 * Playwright applies extraHTTPHeaders to EVERY request the page makes, not
 * just the top-level navigation. A real browser varies `Accept` by request
 * type and sends `Upgrade-Insecure-Requests: 1` on navigations only - never
 * on XHR/fetch - so forcing COMMON_HEADERS here stamped an impossible
 * combination on every API call the page made.
 *
 * Zepto (AWS WAF) fingerprints exactly that: with `Upgrade-Insecure-Requests`
 * forced on all requests, every page load was served the WAF JS challenge
 * instead of the product page, so the location picker never rendered and each
 * target failed on its first pre-action. Bisected header-by-header
 * 2026-08-13: Accept-Language alone and Accept alone both load fine,
 * Upgrade-Insecure-Requests alone reproduces the challenge 100%.
 *
 * Chromium already sends correct Accept and Upgrade-Insecure-Requests values
 * per request type, so there is nothing to replace them with.
 */
const BROWSER_CONTEXT_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
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
 * Depth-first search for the object a JsonFind describes - the first one
 * carrying `where === equals` AND every field in `select`. Returns the
 * flattened "field=value;" text, or null when no such object exists.
 *
 * Requiring all of `select` is what skips the near-miss objects: Blinkit's
 * response repeats the product id on cart-action stubs and analytics blobs
 * that carry `inventory` but no `is_sold_out`, and reading stock off one of
 * those would be silently wrong rather than loudly broken.
 */
function resolveJsonFind(root: unknown, find: JsonFind): string | null {
  let found: string | null = null;

  (function walk(node: unknown): void {
    if (found !== null || node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    if (
      obj[find.where] !== undefined &&
      String(obj[find.where]) === find.equals &&
      find.select.every((f) => obj[f] !== undefined)
    ) {
      found = find.select.map((f) => `${f}=${String(obj[f])};`).join("");
      return;
    }

    for (const key of Object.keys(obj)) walk(obj[key]);
  })(root);

  return found;
}

/**
 * Owns a single shared Playwright browser instance for the whole run so we
 * don't pay browser-launch cost on every target/cycle. Call close() on
 * shutdown.
 */
export class StockChecker {
  private browser: Browser | null = null;
  // One long-lived page per origin for the "browser-api" strategy. Every
  // target on that origin reuses it, so a cycle pays a single page load
  // instead of one per check - and the accumulated cookies make the
  // subsequent JSON calls look like an ordinary browsing session rather
  // than a cold hit each time.
  private apiPages = new Map<string, { context: BrowserContext; page: Page }>();

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.headless });
  }

  async close(): Promise<void> {
    this.apiPages.clear();
    await this.browser?.close();
    this.browser = null;
  }

  async check(target: Target): Promise<StockResult> {
    const checkedAt = new Date().toISOString();
    try {
      let status: { status: StockStatus; detail: string; context?: Record<string, unknown> };
      if (target.strategy === "dom") {
        status = await this.checkDom(target);
      } else if (target.strategy === "browser-api") {
        status = await this.checkBrowserApi(target);
      } else {
        status = await this.checkApi(target);
      }
      return { target, status: status.status, checkedAt, detail: status.detail, context: status.context };
    } catch (err: any) {
      logger.error(`Check failed for target "${target.id}"`, { error: err.message });
      return { target, status: "UNKNOWN", checkedAt, error: err.message };
    }
  }

  /** Gets (or opens) the shared page this origin's browser-api calls run in. */
  private async apiPageFor(origin: string): Promise<Page> {
    if (!this.browser) throw new Error("Browser not initialized - call init() first");

    const existing = this.apiPages.get(origin);
    if (existing && !existing.page.isClosed()) return existing.page;

    const context = await this.browser.newContext({
      userAgent: config.userAgent,
      locale: "en-IN",
      extraHTTPHeaders: BROWSER_CONTEXT_HEADERS,
    });
    const page = await context.newPage();
    // Only needs to reach "a document on this origin exists" - the fetches
    // below are what actually carry the query, so there's nothing to wait
    // for beyond the origin being live and its cookies set.
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: config.requestTimeoutMs });
    this.apiPages.set(origin, { context, page });
    return page;
  }

  private async checkBrowserApi(target: Target): Promise<{ status: StockStatus; detail: string }> {
    if (!target.jsonPath && !target.jsonFind) {
      throw new Error(`Target "${target.id}" uses "browser-api" strategy but has neither jsonPath nor jsonFind`);
    }

    const page = await this.apiPageFor(new URL(target.url).origin);

    const result = await page.evaluate(
      async (req: { url: string; method: string; headers: Record<string, string>; body: string | null }) => {
        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          credentials: "include",
        });
        return { status: res.status, text: await res.text() };
      },
      {
        url: target.url,
        method: target.method ?? "GET",
        headers: { "Content-Type": "application/json", ...target.requestHeaders },
        body: target.method === "POST" ? JSON.stringify(target.requestBody ?? {}) : null,
      }
    );

    if (result.status >= 400) {
      throw new Error(`HTTP ${result.status} from ${target.url}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      // A bot-check interstitial answers 200 with HTML - surface that as a
      // real error instead of letting it fall through to OUT_OF_STOCK.
      throw new Error(`Non-JSON response from ${target.url}: ${result.text.slice(0, 120)}`);
    }

    return this.interpretJson(parsed, target);
  }

  /**
   * Saves a screenshot + full HTML dump for a failed DOM check, so a
   * pre-action selector timeout can be told apart from "site changed its
   * markup" vs. "got served a bot-detection/CAPTCHA/blocked page" without
   * needing a live browser on hand. Swallows its own errors - a failed debug
   * capture should never mask the real check error.
   */
  private async captureDebugArtifacts(page: Page, targetId: string): Promise<void> {
    try {
      await fs.mkdir(config.debugDir, { recursive: true });
      const base = path.join(config.debugDir, targetId);
      await page.screenshot({ path: `${base}.png`, fullPage: true });
      await fs.writeFile(`${base}.html`, await page.content());
    } catch (err: any) {
      logger.warn(`Failed to capture debug artifacts for "${targetId}"`, { error: err.message });
    }
  }

  private async checkDom(target: Target): Promise<{ status: StockStatus; detail: string }> {
    if (!this.browser) throw new Error("Browser not initialized - call init() first");
    if (!target.selector) throw new Error(`Target "${target.id}" uses "dom" strategy but has no selector`);

    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      context = await this.browser.newContext({
        userAgent: config.userAgent,
        locale: "en-US",
        extraHTTPHeaders: BROWSER_CONTEXT_HEADERS,
      });

      if (target.cookies?.length) {
        await context.addCookies(target.cookies.map((c) => ({ ...c, path: c.path ?? "/" })));
      }

      page = await context.newPage();

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
    } catch (err) {
      if (page) await this.captureDebugArtifacts(page, target.id);
      throw err;
    } finally {
      await context?.close();
    }
  }

  private async checkApi(target: Target): Promise<{ status: StockStatus; detail: string }> {
    if (!target.jsonPath && !target.jsonFind) {
      throw new Error(`Target "${target.id}" uses "api" strategy but has neither jsonPath nor jsonFind`);
    }

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

    return this.interpretJson(response.data, target);
  }

  /**
   * Turns a parsed JSON body into a status + detail, for both the plain-axios
   * and in-browser API paths (they differ only in how the bytes were fetched).
   */
  private interpretJson(
    data: unknown,
    target: Target
  ): { status: StockStatus; detail: string; context?: Record<string, unknown> } {
    if (target.jsonFind) {
      const foundText = resolveJsonFind(data, target.jsonFind);
      // Throwing (rather than falling through to the OUT_OF_STOCK default)
      // is deliberate: "the product's object vanished from the response"
      // means the API shape changed, which must surface as a loud UNKNOWN +
      // logged error, not as a quiet "not in stock" that looks like a
      // healthy check forever.
      if (foundText === null) {
        throw new Error(
          `jsonFind ${target.jsonFind.where}=${target.jsonFind.equals} not found in response for target "${target.id}"`
        );
      }
      return { status: resolveStatus(foundText, target), detail: foundText };
    }

    const value = resolveJsonPath(data, target.jsonPath!);
    if (value === undefined) {
      throw new Error(`jsonPath "${target.jsonPath}" not found in response for target "${target.id}"`);
    }

    // Objects/arrays are matched against their JSON text: an availability
    // signal is sometimes structural rather than a scalar - e.g. Croma's
    // delivery-promise response, where in-stock means the promiseLine array
    // has entries and out-of-stock means an unavailableReason appears.
    const rawText = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

    // detailJsonPath (optional) swaps the debug detail for a human-facing
    // extract that the notifier appends to alerts - see Target.detailJsonPath.
    let detail = rawText.slice(0, 300);
    if (target.detailJsonPath) {
      const detailValue = resolveJsonPath(data, target.detailJsonPath);
      if (detailValue !== undefined) {
        detail = (typeof detailValue === "object" ? JSON.stringify(detailValue) : String(detailValue)).slice(0, 300);
      }
    }

    // contextJsonPaths (optional) captures raw values for post-check analysis
    // rather than for display - see Target.contextJsonPaths. A missing path is
    // simply absent from the map: these are supplementary signals, and a
    // response that legitimately lacks one (Reliance Digital's `{}`
    // not-deliverable body has no long_lat) must not fail the whole check.
    let context: Record<string, unknown> | undefined;
    for (const contextPath of target.contextJsonPaths ?? []) {
      const contextValue = resolveJsonPath(data, contextPath);
      if (contextValue === undefined) continue;
      context = context ?? {};
      context[contextPath] = contextValue;
    }

    return { status: resolveStatus(rawText, target), detail, context };
  }
}
