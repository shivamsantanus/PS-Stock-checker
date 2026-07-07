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

Two extra `dom`-strategy fields exist for sites that gate availability
behind a delivery location (see "Quick-commerce platforms" below):

- **`cookies`** — set directly on the browser context before navigating, for
  sites that read delivery pincode/address from a cookie.
- **`preActions`** — a list of `{ action: "fill" | "click", selector, value?,
  waitAfterMs? }` steps run after page load and before reading `selector`,
  to drive an on-page location picker (type a pincode, click a suggestion).

The selectors/endpoints shipped in `targets.ts` are placeholders — every
retailer's site is different and changes over time. Inspect your actual
target site and fill in real values before running this live.

## Quick-commerce platforms (BigBasket, Flipkart Minutes, Blinkit, Instamart, Zepto, ...)

These are meaningfully harder to monitor reliably than a normal retailer
page, for two structural reasons:

1. **Location-gated availability.** Stock is scoped to a specific
   dark-store/warehouse, resolved from a pincode or GPS address you have to
   set via their UI (or occasionally a cookie) before the product page shows
   real availability. That's what `preActions`/`cookies` above are for.
2. **Bot detection varies a lot by platform, and changes without notice.**
   Roughly, from more to less scrapable with a plain headless browser:
   - **BigBasket, Flipkart Minutes** — standard e-commerce web flow, so a
     `dom` strategy with `preActions` for the pincode picker generally
     works. Flipkart in particular runs aggressive bot detection (Akamai);
     expect occasional CAPTCHAs/blocks and keep intervals conservative.
   - **Blinkit, Swiggy Instamart, Zepto** — built app-first. Their web
     versions exist but availability/location logic often leans on
     internal APIs with device/session tokens that a plain browser context
     doesn't have, so `preActions` may not fully replicate what the app
     does. Treat the example targets in `targets.ts` for these three as a
     starting point to adapt, not as working code.

Practical recommendations:

- Open each real target in an actual browser first, use DevTools to find
  the true location-picker selectors and the stock-badge selector/text for
  your pincode, and replace the placeholders — they will not match live
  markup as shipped.
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

## How it avoids looking like a bot

- Realistic desktop Chrome user-agent + Accept/Accept-Language headers.
- Sequential checks per cycle (not parallel), each pair separated by a
  randomized delay (`MIN/MAX_DELAY_BETWEEN_TARGETS_MS`).
- The whole cycle repeats on `CHECK_INTERVAL_MINUTES` +/- a random
  `JITTER_SECONDS`, instead of a perfectly uniform cron tick.

None of this guarantees you won't be bot-blocked by something like
Cloudflare on a well-defended site — for consistently reliable checks,
prefer the `"api"` strategy over `"dom"` wherever the site exposes one.
