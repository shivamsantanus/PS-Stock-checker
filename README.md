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
│   ├── targets.ts         # non-pincode targets + the 2 pincode-driven target factories
│   ├── pincodeStore.ts    # reads/writes data/pincodes.json (shared by targets.ts and the admin UI)
│   ├── admin/             # `npm run admin` - browser UI for managing pincodes, see below
│   ├── logger.ts          # timestamped leveled console logger
│   ├── stateManager.ts    # reads/writes data/state.json, detects transitions
│   ├── notifier.ts        # Discord webhook + Telegram Bot API integration
│   ├── scraper.ts         # Playwright (DOM) + Axios (API) check strategies
│   └── index.ts           # scheduler / main loop / entrypoint
├── data/
│   ├── pincodes.json      # pincodes/addresses to monitor - edit via `npm run admin`, tracked in git
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
  Optional extras for storefront APIs that need more than a bare GET:
  `method: "POST"` + `requestBody` (a JSON body, e.g. Croma's
  delivery-promise payload), `requestHeaders` (merged over the defaults —
  for public app tokens like Reliance Digital's Bearer or Croma's
  subscription key), and `displayUrl` (the human-facing product page to
  link in notifications instead of the raw API endpoint). If `jsonPath`
  resolves to an object/array, matching runs against its JSON text — so a
  structural signal like "the promiseLine array has entries" works with
  plain substring values.

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

The pincodes/addresses fed into the Blinkit and Reliance
Digital targets are the one part of `targets.ts` you don't need to edit by
hand — see "Managing pincodes" below.

## Turning stores on and off

```bash
npm run admin
# open http://localhost:4321
```

The **Stores** panel at the top is a switch per retailer. Flip one off and
every target belonging to it is dropped before the checker runs — no request
is made, no state is written, and no alert can fire for it. Each row shows how
many checks that store contributes per cycle, so you can see the cost of
keeping it on (Blinkit and Reliance Digital scale with the pincode list; the
rest are fixed).

Switches live in `data/platforms.json`, a flat `{ "amazon": true, … }` map.
Anything missing from that file defaults to **on**, so a fresh checkout — or a
retailer added in a later commit — tracks everything until you say otherwise.

- **Switching off is not deleting.** All the verified selectors, API contracts
  and post-mortems in `targets.ts` stay put, and `data/state.json` history is
  untouched — flip a store back on and it resumes from the status it was last
  at rather than re-alerting. Use a switch for a retailer that's gone quiet;
  delete the target outright only when a listing is genuinely dead (404'd
  product, retailer left the market).
- **A switched-off store is logged at startup**, e.g.
  `2 store(s) switched OFF, not being checked { off: 'Croma, Amazon.in' }` —
  so a missed restock can never be silently explained by a forgotten switch.
- **Commit `data/platforms.json`** for the GitHub Actions cron to respect it,
  the same as `data/pincodes.json`.

## Managing pincodes

Same page, **Pincodes** panel below the stores — add, edit, or delete a
pincode without touching any `.ts` file. Only the two per-location stores use
this list: Blinkit and Reliance Digital. It reads and writes
`data/pincodes.json` directly; `src/targets.ts` loads that same file at
startup to build the actual target list, so every pincode row becomes 2
Blinkit targets and, if you also check the "Reliance Digital" box, 3 more.

Exactly one row (560001) has the Reliance Digital box ticked. That single row
is the only thing generating RD targets — untick it everywhere and RD
coverage silently drops to zero. The **Stores** panel at the top of the same
page shows the live check count each store contributes, so you can see the
effect of adding or removing a pincode immediately.

A few things worth knowing:

- **`Search text override`** is optional and normally left blank (the bare
  pincode is typed into the site's location picker). Set it when a bare
  pincode resolves ambiguously to more than one dark-store zone — this
  happened live with 560067/Kadugodi, where searching the bare pincode
  returned several distinct locality suggestions serving different stores.
  In that case, type a fuller address (street/area + pincode) so the first
  suggestion clicked is deterministically the right one — check the result
  in a real browser first to confirm which suggestion it resolves to.
- **Reliance Digital is opt-in per row** (unchecked by default) because
  nearby pincodes usually resolve to the same regional RD store — ticking it
  for every Bangalore pincode you track on quick-commerce would just repeat
  the same RD check dozens of times per cycle for no new information. Tick
  it for one representative pincode per city instead.
- **Deleting a row stops checking it going forward** but doesn't touch any
  history already recorded in `data/state.json` (that file just keys off
  target id, and unrecognized ids are ignored).
- **`ADMIN_PORT`** env var overrides the default port `4321` if it's taken.
- **This only edits your local file.** `data/pincodes.json` is tracked in
  git (unlike `data/state.json`) — if you rely on the GitHub Actions cron
  (see "Running 24/7 on GitHub Actions" below), commit and push it after
  making changes so the next scheduled run picks them up.

## Retailer confidence (PS5 console, India)

`targets.ts` ships with three tiers of confidence, based on live testing
done while building this — not guesses:

- **Sony Center (shopatsc.com) — REMOVED 2026-08-07, retailer left the
  market.** Its Shopify `/products/<handle>.js` endpoints for both console
  SKUs now return 404, and its entire `playstation-5` collection (67
  products, pulled live) contains no console at all — only console *covers*
  and accessories. The read never broke; there is simply nothing to check.
  Worth remembering that this was previously the most reliable target in the
  file (a clean `available: true/false` boolean, no scraping, no bot
  detection) — reliability of the *mechanism* says nothing about whether the
  retailer still sells the product. If it relists, re-add an `"api"` target
  on `jsonPath: "available"` and find the handle via
  `/search/suggest.json?q=<query>&resources[type]=product` or
  `/collections/playstation-5/products.json?limit=250`.
  **Physical Sony Center / Sony Exclusive stores (~113 across India) cannot
  be stock-checked** — investigated 2026-07-15: shopatsc has no in-store
  pickup (so Shopify exposes no per-location inventory), and the site's own
  "Find Store" API (`shopatsonycenter.com/api/get-sony-center`) returns a
  pure directory (name/address/phone/coordinates) with zero inventory
  fields. When an online alert fires, that directory is still handy for
  finding a nearby store to phone.
- **Games The Shop (gamestheshop.com) — verified via internal API, high
  confidence, location-independent.** The PlayStation-exclusive retail chain
  of E-xpress Interactive, Sony's official PlayStation distributor in India.
  Custom Next.js storefront backed by an open JSON API
  (`green-api.gamestheshop.com/storefront/products/<id>`) that answers a
  completely bare GET — no cookies, no tokens. `data.stock_status` reads
  `"In Stock"`/`"Out of Stock"` and `data.total_inventory` carries a live
  unit count, which alerts surface as "Units in stock: N" so you know how
  hard to race. Verified both ways live 2026-07-15 (both PS5 Slim SKUs out
  of stock, an in-stock accessory reading `In Stock`/5 at the same moment).
  National online inventory — their physical stores don't expose per-store
  stock online either.
  **Pre-order detection, added 2026-07-16:** GTS has a genuine
  `is_pre_order` boolean + `release_date`, confirmed live against real
  upcoming-game listings. Crucially, pre-order items still read
  `stock_status: "In Stock"` — identical to genuine ready-to-ship stock —
  so `is_pre_order` is checked first and routes to `COMING_SOON` instead of
  a misleading "in stock, buy now" alert. Dormant for both tracked PS5 SKUs
  today (`is_pre_order: false`).
- **Amazon.in — verified selector, high confidence in the read,
  location-dependent.** `#availability` carries a distinct line in all three
  states, each verified live: `"In stock"`, `"Currently unavailable. We don't
  know when or if this item will be back in stock."`, and — for genuine
  pre-orders — `"This item will be released on <date>. Pre-order now."`
  (confirmed against an active GTA VI PS5 listing, so pre-order detection
  needed no new scraping infrastructure).
  **Missed-restock post-mortem, fixed 2026-08-07:** the risk with Amazon is
  picking the wrong *listing*, not misreading it. This checker originally
  tracked a single ASIN — `B08FV5GC28`, the 2020 launch console — which is
  retired and had read "Currently unavailable" on every check for a month
  straight while Amazon restocked other listings. That ASIN was dropped
  entirely on 2026-08-07 as a discontinued console generation. It now tracks
  **14 listings**: the plain Slim Disc/Digital SKUs, the newer Sony-India-sold
  Slim listing, the legacy console listing, and every Sony console *bundle*
  (Fortnite, ASTRO BOT, Call of Duty, EA FC 26, 30th Anniversary,
  2-controller) — bundles included deliberately, because a restock often
  lands on a bundle SKU while the plain listing stays unavailable.
  **How to refresh the ASIN list:** do *not* use keyword search — amazon.in
  drops out-of-stock console listings out of search results entirely (a
  search for "ps5 slim" returns almost nothing but accessories). Walk
  Amazon's own PlayStation 5 › Consoles bestseller node
  (`/gp/bestsellers/videogames/20904636031/`), which still ranks them. As of
  2026-08-07 there is **no Sony-sold PS5 Pro listing on amazon.in at all** —
  only third-party Pro accessories.
- **Flipkart — verified via structured data, high confidence for "in stock
  somewhere," location-dependent for "deliverable to you."** Every product
  page embeds a `<script type="application/ld+json" id="jsonLD">` block
  (schema.org markup, kept stable for Google Shopping/SEO) with
  `offers.availability` — far more reliable than Flipkart's own
  auto-generated/rotating CSS classes, which have no stable selector at all.
- **Reliance Digital — verified via internal API, high confidence,
  location-DEPENDENT (checked per pincode).** The site runs on the Fynd
  commerce platform. Auth is the static public Bearer token the site's own
  frontend sends (embedded in its JS bundle — re-grab from DevTools if it
  ever rotates); the request-signing header the site also sends is not
  enforced server-side (verified live 2026-07-15). The earlier dom-strategy
  blockers (an "Apply" control that's a `<p>` not a button, and a Vue
  placeholder buy-box) are moot — no page load needed.
  **Hard-won lesson (live false alert, same day as wiring):** the catalog
  sizes endpoint's `sellable: true` — and even the PDP's own JSON-LD
  "InStock" markup — is a *national catalog* flag meaning "some RD store
  somewhere holds this item," not "you can order it." The real buy-box
  signal is the per-pincode article endpoint
  (`/catalog/v2.0/products/<slug>/sizes/OS/price/?pincode=…`), which returns
  a seller offer (article id + live quantity) when deliverable and a bare
  `{}` when not. Verified live: the same SKU at the same moment was a qty-4
  offer for Bangalore 560075 and `{}` for Patiala/Cuttack/Lucknow. RD
  consoles ship from regional store inventory, so targets fan out per city
  (one representative pincode each), like the quick-commerce platforms.
  **Second hard-won lesson — phantom store stock (live case, same day):**
  an offer sourced from a physical retail store ("Mantri Bangalore", qty 4)
  passed every anonymous check — the article endpoint AND a real cart-add
  validated by RD's own allocator — yet payment rejected it with "article
  not available". The order-time inventory check sits behind the login wall;
  nothing visible anonymously distinguishes such offers (TAT/distance/
  delivery-promise are null for all products, orderable ones included). RD
  alerts therefore include the fulfilling store's name via `detailJsonPath`:
  read "Source:" in the alert — a mall-store source may be display/reserved
  units that fail at payment; treat every RD alert as "go try immediately,"
  not a guarantee.
  **Phantom mitigation — store distance, added 2026-08-07.** The offer body
  also carries `long_lat`, the fulfilling store's coordinates (in
  `[longitude, latitude]` order). `src/phantomDetection.ts` measures that
  against the coordinates of the pincode actually being asked about and flags
  anything over 150km, which downgrades the alert to "⚠️ SUSPECTED STOCK
  (unconfirmed)" with the distance spelled out. This replaced a guard that
  could never fire in the current setup: the original rule compared the
  fulfilling store across *two* pincodes, so with only 560001 ticked for RD
  it had nothing to compare and silently did nothing. Both rules now run —
  the distance rule needs just one result, and also catches the case the
  cross-pincode rule structurally cannot see at any scale (a store far from
  *every* tracked pincode fulfils them all "consistently"). Measured live on
  2026-08-07 against all three SKUs from 560001: Mantri Bangalore 2km (clean,
  no warning), Rudrampeta/Anantapur 189km and Dr. AS Rao Nagar/Hyderabad
  511km (both flagged). Nothing is ever suppressed — a flagged result still
  alerts, just without the confident framing, since a distant store could
  still be a genuine regional warehouse.
  **Pre-order watch, added 2026-07-16:** re-verified TAT/distance/
  delivery-promise are still null/absent. Separately found the real catalog
  product-detail endpoint is v1.0, not v2.0 (v2.0 404s) — its
  `_custom_json.pre_order_enabled` field is a genuine, currently-live
  pre-order flag RD's Fynd platform uses for other launches (e.g. new
  phones). One target per SKU watches this (not fanned per pincode — it's a
  product attribute, not a deliverability check). Dormant for all 3 PS5
  SKUs today (`pre_order_enabled: false`).
  **SKUs tracked (3, as of 2026-08-07):** PS5 Slim Disc (CFI-2008A01X,
  ₹54,990), PS5 Slim Digital (CFI-2008B01X, ₹49,990), and PS5 Standard
  "SA E-chassis" (CFI-2116A01Y, ₹69,990 — added 2026-08-07). The last is a
  distinct product, not a re-slug: the v1.0 endpoint reports its Model as
  CFI-2116A01Y and all three slugs answer 200 at the same moment. The
  pre-Slim Digital Edition was dropped the same day as discontinued.
- **Croma — verified via internal API, high confidence,
  location-independent in practice.** The website itself hard-blocks
  automation (Akamai edge 403 on every non-headful load — curl, axios, and
  headless Chromium/Chrome alike; only headful real Chrome passes, and
  cookies minted there don't transfer back to headless). But the OMS
  delivery-promise endpoint the product page itself calls
  (`POST api.croma.com/inventory/oms/v2/tms/details-pwa/`) answers to plain
  axios with no cookies — just the public `oms-apim-subscription-key` header
  every visitor's browser sends. In stock ⇒ the response carries an HDEL
  promise line with a delivery date for the requested pincode; out of stock
  ⇒ an `unavailableReason` (verified both ways 2026-07-15, cross-checked
  against the real page's disabled/enabled Add to Cart buttons). Live-tested
  across 5 pincodes: availability was identical everywhere, only delivery
  dates differed — so one representative pincode per SKU suffices.
  **Investigated for pre-order detection, 2026-07-16, not wired:** every
  in-stock item's promise line carries an undocumented `extn.preOrderItem`
  string field — the obvious "this is a pre-order" signal — but it read as
  an empty string on every one of ~20 live products sampled (no active
  pre-order product currently exists on croma.com to see a populated value
  against). Left documented but inactive rather than matching against a
  guessed value — same rule that caught the `sellable` false positive above.
- **Excluded after live testing, not shipped:** Vijay Sales (a real
  OOS/in-stock signal exists, but the page interleaves this product with an
  unrelated "related products" carousel using the same classes — `.first()`
  picked up the wrong card in testing).

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

The excluded retailer isn't unfixable — `cookies`/`preActions`/`press`
exist specifically to support flows like Vijay Sales'. Picking it up
yourself means running with `HEADLESS=false` and walking through the real
flow in DevTools; the notes above give you the exact selectors/endpoints
already found so you're not starting from zero. (Croma and Reliance Digital
were recovered exactly this way — their sites resist scraping, but the JSON
APIs their own pages call turned out to be openly callable. When a `dom`
target fights back, always check the Network tab for the underlying API
first.)

## Quick-commerce platforms (Blinkit — and why the others were removed)

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
     (e.g. `blinkit-ps5-147002`) are real, not placeholders. One gotcha found
     live: the product page also renders "Top 10 products in this category"
     / "People also bought" carousels full of *other* products' "ADD"
     buttons, so the stock selector must be scoped to the product's own
     info panel (`ProductWrapperRightSection`) or it'll false-positive on
     an unrelated carousel item — the same trap that excluded Vijay Sales
     above.
   - **Zepto — REMOVED 2026-08-07, product delisted.** Both tracked PS5
     product pages now serve Zepto's 404 page, and a live catalog search for
     "playstation" returns only controllers, games and accessories — no
     console in any form. The scraping approach was sound and is preserved
     verbatim in the removal note at the top of `targets.ts`, so it can be
     re-wired if Zepto ever relists. Cost of leaving it in: 66 targets ×
     30s Playwright timeout ≈ **34 minutes of every cycle** spent failing,
     plus 212 junk dumps in `data/debug/`.
   - **Swiggy Instamart — REMOVED 2026-08-07, never worked once.**
     `data/state.json` had no entry for it at all, meaning every run since
     it was wired ended in an exception. Two independent causes: the item
     page now returns Swiggy's "Something went wrong!" error screen for
     automation, and — more instructive — its selector
     `[data-testid='sold-out']` **only exists in the sold-out state**, so on
     a restock the element never appears, the wait times out, and the check
     throws. The one event it existed to catch was the exact event it could
     not report. Any replacement must watch a container present in *both*
     states.
   - **BigBasket, Flipkart Minutes — REMOVED 2026-08-07, never real.** These
     shipped as placeholders pointing at literal `example-product` URLs with
     invented selectors, so they could only ever time out. Deleted because a
     placeholder that always fails is indistinguishable in the logs from a
     real target that just broke.

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

## Tiered polling (added 2026-08-08)

Targets are split by how expensive they are to check, and the two tiers run
as **concurrent loops** rather than one interleaved cycle:

| Tier | Targets | Default cadence | What they are |
| --- | --- | --- | --- |
| Hot | `strategy: "browser-api"` | every 60s (`HOT_INTERVAL_SECONDS`) | one `fetch` on an already-open page, no render — all the Blinkit per-pincode checks |
| Cold | everything else | every 5 min (`COLD_INTERVAL_MINUTES`) | full page renders plus the batched Reliance Digital phantom pass |

Why they are separate loops: a cold sweep takes **~2.5 minutes** measured
(27 targets, 16 of them DOM renders), so running both in one cycle stalled
the cheap checks behind the expensive ones. Previously all 55 targets ran
sequentially at one interval and spent ~3.7 minutes per cycle merely
*asleep* between targets.

**Escalation.** When the hot tier sees any target newly go `IN_STOCK` or
`COMING_SOON`, it pulls the cold sweep forward instead of waiting out its
interval — restocks often land across several retailers within minutes.

**Rate-limit backoff — and why the defaults are not more aggressive.**
Measured 2026-08-08: a 30s hot interval at concurrency 4 got HTTP 429'd by
Blinkit on its *second* sweep. The hot targets are only **two** distinct
product endpoints (one per SKU) fetched once per pincode with different
`lat`/`lon` headers, so a sweep lands N hits on the same URL within seconds —
that, not the target count, is what trips the limit. At 60s/concurrency 2 a
sweep takes ~12s and 429s are occasional and transient. If more than a
quarter of a sweep comes back rate-limited, the interval doubles (up to
`HOT_BACKOFF_MAX_SECONDS`) and only resets after a clean sweep.

A rate-limited check reads `UNKNOWN` and is skipped for state purposes — it
never turns into a false `OUT_OF_STOCK`.

> Hot-tier jitter is `HOT_JITTER_PERCENT` of the interval, **not** the flat
> `JITTER_SECONDS` used by the cold tier. That value is sized for a
> 10-minute cadence; applying ±30s to a 30s interval let two sweeps fire ~10s
> apart, which is how the 429s above were first provoked.

## Running 24/7 on your own PC (Windows)

Preferred over the GitHub Actions cron below — no scheduling delay, no
per-run setup cost, and the process keeps one browser warm.

```bash
npm run build
npm run install-task     # registers a Scheduled Task, starts at logon
```

Then `Start-ScheduledTask -TaskName PS5StockChecker` to start it immediately
without logging out. The task restarts itself on crash and has no execution
time limit. See `scripts/install-windows-task.ps1` for the management
commands (status/stop/remove).

Two things to know:

- The task runs **at logon**, so it does not check while you are signed out
  unless you reconfigure it to "Run whether user is logged on or not".
- **Disable the GitHub Actions cron if you run this locally**, or you will
  get duplicate alerts from two independent checkers with two independent
  state stores. Comment out the `schedule:` block in
  `.github/workflows/stock-check.yml` (leaving `workflow_dispatch` so you can
  still trigger it by hand).

## How it avoids spam

`data/state.json` stores the last known status per target. A notification
only fires on an `OUT_OF_STOCK`/`UNKNOWN` -> `IN_STOCK` transition. Repeated
checks while a target stays in stock (or stays out of stock) produce no
notification, only a log line.

Because the tiers run concurrently and the hot sweep checks several targets
at once, every state write is serialized onto a single chain (see
`persist()` in `src/stateManager.ts`) — otherwise concurrent writes would
race on the same temp file and one could publish another's partial bytes.

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
- Cold-tier checks run sequentially (not parallel), each pair separated by a
  randomized delay (`MIN/MAX_DELAY_BETWEEN_TARGETS_MS`).
- Hot-tier checks run at a small fixed concurrency (`HOT_CONCURRENCY`, default
  2) with a random 0-`HOT_REQUEST_JITTER_MS` pause before each request, so a
  sweep is a few overlapping requests rather than a uniform burst.
- Each tier repeats on its own interval +/- random jitter, instead of a
  perfectly uniform cron tick.

None of this guarantees you won't be bot-blocked by something like
Cloudflare on a well-defended site — for consistently reliable checks,
prefer the `"api"` strategy over `"dom"` wherever the site exposes one.
