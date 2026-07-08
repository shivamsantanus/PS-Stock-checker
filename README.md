# PS5 Stock Checker

Automated, multi-location stock monitor. Runs on a jittered interval, checks
each configured target (store page, JSON API, or a location-gated
quick-commerce product page), and pings Discord and/or Telegram the moment
any target flips from out-of-stock to in-stock. Never re-alerts while a
target stays in stock.

## File structure

```
.
├── src/
│   ├── config.ts        # env var loading & validation
│   ├── types.ts          # shared TypeScript interfaces
│   ├── targets.ts         # <-- edit this: your list of locations to watch
│   ├── logger.ts          # timestamped leveled console logger
│   ├── stateManager.ts    # reads/writes data/state.json, detects transitions
│   ├── notifier.ts        # Discord webhook + Telegram Bot API integration
│   ├── scraper.ts         # Playwright (DOM) + Axios (API) check strategies
│   └── index.ts           # scheduler / main loop / entrypoint
├── data/
│   └── state.json         # generated at runtime, gitignored
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set DISCORD_WEBHOOK_URL and/or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
# (at least one channel is required - both fire if both are set)
```

### Getting Telegram credentials

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, follow the
   prompts. It gives you a bot token like `123456789:AAExample...`.
2. Send any message to your new bot (search its username and say hi).
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and
   copy the `id` field under `"chat"` in the JSON response - that's your
   `TELEGRAM_CHAT_ID`.
4. For alerts in a group instead of a DM, add the bot to the group, send a
   message there, then repeat step 3 - group chat ids are negative numbers.

`npm install` runs `playwright install chromium` automatically via the
`postinstall` script. If that's blocked in your environment, run it manually:

```bash
npx playwright install chromium
```

## Configure your targets

Edit `src/targets.ts`. Each entry is either:

- **`strategy: "dom"`** — loads `url` in a real headless browser and reads
  the text of `selector`. Use when the retailer only renders availability
  client-side with JS.
- **`strategy: "api"`** — calls `url` directly with axios and reads
  `jsonPath` out of the JSON response. Use this whenever you can find the
  underlying JSON endpoint (check the browser Network tab) — it's faster
  and far less likely to trip bot detection than a full browser render.

`inStockValues` is a list of case-insensitive substrings; if the scraped
text/value contains any of them, the target is considered `IN_STOCK`.
`outOfStockValues` (optional) is checked first — use it when a site reliably
renders an explicit "Out Of Stock"/"Notify Me" marker, since that's often a
more trustworthy signal than the mere presence of "Add to Cart" text
elsewhere on a busy page (recommendation carousels, etc). If neither list
matches, the target is reported `OUT_OF_STOCK` — an inconclusive read should
never look like "in stock."

Extra `dom`-strategy fields exist for sites that gate availability behind a
delivery location (see "Quick-commerce platforms" below):

- **`cookies`** — set directly on the browser context before navigating, for
  sites that read delivery pincode/address from a cookie.
- **`preActions`** — a list of `{ action: "fill" | "click" | "press",
  selector, value?, waitAfterMs? }` steps run after page load and before
  reading `selector`, to drive an on-page location picker (type a pincode,
  click a suggestion, or press Enter to submit).

## Retailer confidence (PS5 console, India)

`targets.ts` ships with three tiers of confidence, based on live testing
done while building this — not guesses:

- **Sony Center (shopatsc.com) — verified, high confidence, location-independent.**
  Sony's official-branded retail chain runs on Shopify, which exposes a
  public `/products/<handle>.js` endpoint with a clean `available: true/false`
  boolean per product. This is an `"api"` strategy target: no DOM scraping,
  no bot-detection exposure, no fragile UI flow, and it's a genuine national
  online sale — no per-pincode ambiguity. If this shows in stock, you can
  actually buy it. Sony doesn't sell PS5 hardware through its own sony.co.in
  store in India — this is the closest thing to an official first-party
  channel. Covers both the Standard and Digital Edition console SKUs.
- **Amazon.in — verified selector, medium confidence, location-dependent.**
  `#availability` reliably shows "Currently unavailable." when out of stock.
- **Flipkart — verified via structured data, high confidence for "in stock
  somewhere," location-dependent for "deliverable to you."** Every product
  page embeds a `<script type="application/ld+json" id="jsonLD">` block
  (schema.org markup, kept stable for Google Shopping/SEO) with
  `offers.availability` — far more reliable than Flipkart's own
  auto-generated/rotating CSS classes, which have no stable selector at all.
- **Excluded after live testing, not shipped:** Croma (blocked outright,
  HTTP 403 on a plain page load), Vijay Sales (a real OOS/in-stock signal
  exists, but the page interleaves this product with an unrelated "related
  products" carousel using the same classes — `.first()` picked up the wrong
  card in testing), Reliance Digital (pincode input exists but no reachable
  "Apply" button was found, and the real stock element rendered as an empty
  Vue.js placeholder on initial load).

**⚠️ Important: Amazon and Flipkart's "in stock" is not "in stock near you."**
Neither exposes a scriptable way to check a chosen city/pincode — both
default to whatever location their server resolves from the request's IP,
and their real delivery-location pickers do not respond to headless
automation at all (confirmed live: typing a pincode triggers no suggestions
and no network call on either site, and neither has a location cookie that
could be set directly as a shortcut). This was found the hard way — a real
alert fired for Flipkart showing "InStock" while the page separately showed
no seller servicing the actual pincode being checked from.

**What this means practically:**
- **Run this script from your own home connection**, in the city you
  actually care about — since these sites default to IP-resolved location,
  running from home genuinely reflects your area, without needing to
  automate any picker at all.
- **Do not rely on the included GitHub Actions workflow**
  (`.github/workflows/stock-check.yml`) **for Amazon/Flipkart accuracy** —
  GitHub's hosted runners execute from their own cloud datacenters (not
  India), so the resolved location would be arbitrary, not yours. Sony
  Center is unaffected by this (national sale, not location-gated) and is
  fine to run from GitHub Actions or anywhere else.
- Treat an Amazon/Flipkart "in stock" alert as "worth checking right now,"
  not a guarantee it'll be deliverable to you.

None of these mainstream retailers expose true per-city stock the way
quick-commerce apps do — Amazon/Flipkart/Sony Center sell from one national
inventory pool, where a pincode only affects delivery estimate/servicing,
not whether the item exists at all. That's why there's no per-city target
breakdown for Cuttack/Bhubaneswar/Patiala/Chandigarh/Dehradun/Delhi/
Gurugram/Hyderabad/Lucknow/Bangalore/Mumbai/Pune here for these retailers —
running the script from your own city's connection is what actually answers
"is it available near me," not a scripted pincode picker.

The excluded retailers aren't unfixable — `cookies`/`preActions`/`press`
exist specifically to support flows like theirs. Picking it up yourself
means running with `HEADLESS=false` and walking through the real flow in
DevTools; the notes above give you the exact selectors/endpoints already
found so you're not starting from zero.

## Quick-commerce platforms (BigBasket, Flipkart Minutes, Blinkit, Instamart, Zepto, ...)

These are meaningfully harder to monitor reliably than a normal retailer
page, for two structural reasons:

1. **Location-gated availability.** Stock is scoped to a specific
   dark-store/warehouse, resolved from a pincode or GPS address you have to
   set via their UI (or occasionally a cookie) before the product page shows
   real availability. That's what `preActions`/`cookies` above are for.
2. **Bot detection varies a lot by platform, and changes without notice.**
   Roughly, from more to less scrapable with a plain headless browser:
   - **Blinkit — CONFIRMED WORKING, verified live 2026-07-08.** Its web
     "Change Location" modal genuinely responds to headless Playwright:
     typing a pincode returns real suggestions, and clicking one updates the
     delivery address and re-renders availability for that pincode — no app,
     device token, or session cookie needed. The selectors in `targets.ts`
     (`blinkit-ps5-110001`) are real, not placeholders. One gotcha found
     live: the product page also renders "Top 10 products in this category"
     / "People also bought" carousels full of *other* products' "ADD"
     buttons, so the stock selector must be scoped to the product's own
     info panel (`ProductWrapperRightSection`) or it'll false-positive on
     an unrelated carousel item — the same trap that excluded Vijay Sales
     above.
   - **BigBasket, Flipkart Minutes** — standard e-commerce web flow, so a
     `dom` strategy with `preActions` for the pincode picker generally
     works, going by general site behavior — not verified with the same
     live rigor as Blinkit yet. Flipkart in particular runs aggressive bot
     detection (Akamai); expect occasional CAPTCHAs/blocks and keep
     intervals conservative.
   - **Swiggy Instamart, Zepto** — built app-first. Their web versions exist
     but availability/location logic often leans on internal APIs with
     device/session tokens that a plain browser context doesn't have, so
     `preActions` may not fully replicate what the app does. Treat the
     example targets in `targets.ts` for these two as a starting point to
     adapt, not as working code.

Practical recommendations:

- Open each remaining placeholder target in an actual browser first, use
  DevTools to find the true location-picker selectors and the stock-badge
  selector/text for your pincode, and replace the placeholders — they will
  not match live markup as shipped.
- Give these targets a longer `CHECK_INTERVAL_MINUTES` and don't lower
  `MIN/MAX_DELAY_BETWEEN_TARGETS_MS` — the extra `preActions` round-trip per
  check already makes each one slower and more bot-like than a static page
  load.
- Keep this to personal, low-frequency polling. Automated scraping of these
  sites for anything beyond checking availability for yourself likely runs
  against their terms of service.

## Run

```bash
npm run dev      # ts-node, for local development
# or
npm run build && npm start   # compiled JS
```

## How it avoids spam

`data/state.json` stores the last known status per target. A notification
only fires on an `OUT_OF_STOCK`/`UNKNOWN` -> `IN_STOCK` transition. Repeated
checks while a target stays in stock (or stays out of stock) produce no
notification, only a log line.

## Running 24/7 on GitHub Actions

`.github/workflows/stock-check.yml` runs one check cycle on a cron schedule
(roughly every 10 minutes) instead of you hosting a long-running process
yourself. To use it:

1. **Push this repo to GitHub as a public repo.** Actions minutes are free
   and unlimited for public repos; private repos are capped at 2,000
   free minutes/month, which a 10-minute schedule will exceed. Making it
   public exposes your code/target list, not your secrets.
2. In the repo's **Settings -> Secrets and variables -> Actions**, add
   whichever of `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID` you use - same values as your local `.env`.
3. The workflow builds the project, restores `data/state.json` from the
   previous run via `actions/cache`, runs one cycle with `RUN_ONCE=true`,
   then saves the updated state back to the cache so the next run doesn't
   re-alert.
4. Trigger it manually from the Actions tab (`workflow_dispatch`) to test
   before waiting on the schedule.

Caveats vs. hosting it yourself on a VPS:

- GitHub does **not guarantee scheduled workflows run on time** - during
  high load they can be delayed by many minutes, sometimes over an hour.
  Fine for casual monitoring, not for racing other bots to a restock.
- Scheduled workflows are **automatically disabled after 60 days** of no
  repository activity (commits/pushes) - push something occasionally, or
  re-enable it manually from the Actions tab.
- GitHub-hosted runner IPs are recognizable datacenter ranges, which can
  make bot detection on sites like Amazon more likely to trigger than from
  a residential/VPS IP.

## How it avoids looking like a bot

- Realistic desktop Chrome user-agent + Accept/Accept-Language headers.
- Sequential checks per cycle (not parallel), each pair separated by a
  randomized delay (`MIN/MAX_DELAY_BETWEEN_TARGETS_MS`).
- The whole cycle repeats on `CHECK_INTERVAL_MINUTES` +/- a random
  `JITTER_SECONDS`, instead of a perfectly uniform cron tick.

None of this guarantees you won't be bot-blocked by something like
Cloudflare on a well-defended site — for consistently reliable checks,
prefer the `"api"` strategy over `"dom"` wherever the site exposes one.
