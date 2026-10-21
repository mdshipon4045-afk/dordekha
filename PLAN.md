# দরদেখা (Dordekha) — Build Plan & Status

> Bangladesh official market-price ground-truth service. AI-native, zero-budget, self-operating.
> Owner: AI agent (build + operate). Human needed only for: account creation/login, payment
> confirmation, one weekly Facebook-group post, and signing the data-licence letter.

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (needs human) · `[-]` dropped (with reason)

---

## Phase 0 — Verify (no accounts needed)
- [x] **G1** Data acquisition: official MOA JSON API found, keyless, 64 dist × 505 upazila × 447 commodity
- [x] Master dropdowns shape verified (8 div / 64 dist / 505 upazila / 357 market / 447 commodity)
- [x] Daily price report: 93–97 rows/district/day; date gaps confirmed (2026-10-16, 10-10 → 0 rows)
- [x] **Unit bug found**: upstream "quintal" is actually **per 100 kg**. `w/100` → per-kg sits below retail ✓
- [x] `district_id: []` ≠ all districts → must iterate 64 districts explicitly (61/64 have data)
- [x] National scroll endpoint confirmed as fallback
- [x] **Research**: Google AIO −58% CTR ⇒ B2C-page plan dead; AI-citation + MCP/API is the live path
- [x] **Research**: no self-serve crawl-payment rail; Google pilot invite-only; Perplexity by nomination
- [x] **Research**: MCP 2026-07-28 is **stateless** (no initialize handshake) → easy in a Worker
- [x] **Research**: licence-not-data is the proven model (Open-Meteo, OpenCorporates, OpenSanctions)
- [x] **Research**: Bangladesh Copyright Act 2023 §28 → government data is *not* public domain in BD

## Phase 1 — Core engine ✅ **COMPLETE**
- [x] Project scaffold: TS + Vitest 4 + Wrangler 4.151, git initialised
- [x] `src/units.ts` — unit normalisation: measured factor table + arithmetic derivation + plausibility repair
- [x] `src/normalize.ts` — Bangla numerals, carry-forward detection, anomaly flags
- [x] `src/bn.ts` — Bengali nukta folding, question-word stripping, match scoring
- [x] `src/resolve.ts` — name → commodity/district resolution, word-boundary matching, coverage ranking
- [x] `src/moa.ts` — upstream client (retry, timeout, no cookies/CSRF)
- [x] `migrations/0001_init.sql` — D1 schema (price_daily, price_latest, ingest_run, license, usage, alerts, content_page)
- [x] `src/ingest.ts` — cron-driven ingest (one batch per tick, position in D1)
- [x] `src/db.ts` — D1 access layer, chunked upsert under the bound-parameter limit
- [x] `src/render.ts` + `src/pages.ts` — server-rendered Bangla HTML, per-fact permalinks, JSON-LD Dataset
- [x] Content negotiation: `Accept: text/markdown` / `application/json`, `Vary: Accept`, `.md` / `.json` sibling URLs
- [x] `src/mcp.ts` — MCP JSON-RPC: `server/discover`, `tools/list`, `tools/call`; every result carries a citable `url`
- [x] `src/telegram.ts` — daily digest publisher, carry-forward aware
- [x] `/robots.txt` — allow search bots, block training bots
- [x] `/llms.txt`, `/sitemap.xml`, `/health`, `/verify`, `/api/v1/search`
- [x] Static assets: `public/logo.svg` (the market-scale mark), `public/app.js` (progressive enhancement)
- [x] Tests: **58 unit tests** + **53 end-to-end checks**, all green
- [x] Docs: `README.md`, `docs/DATASET.md`, `docs/DEPLOY-BN.md`

### The design — "খাতা" (the ledger)
The visual language comes from the shop ledger this data replaces: a ruled
register with a red margin rule, indigo ink, brass, square corners. The
signature element is "আজকের খাতা" — a live ledger sheet whose last column
is separated by the red rule and stamps every row নতুন / পূর্বের. Honesty
is the product, so the page is built around showing it.

The hero is a thesis, not a pitch: a live lookup where a person types
"পেঁয়াজ ঢাকা" and gets the cited answer in three seconds.

### Measured findings from the live pipeline
- 11,603 rows for 3 report days (64 districts)
- **53.89% of rows are carry-forwards** — upstream copies the previous day's figure more than half the time. Charts must not imply movement that was not reported.
- 1 unit-pair group needed a repair (54 rows), 15 rows could not be verified at all — both are labelled, never hidden.

## Phase 2 — Deployment ✅ **LIVE**
- [x] Cloudflare account + OAuth login
- [x] D1 database `dordekha` (`b8c959ee-…`) + migration 0001 (schema) and 0002 (ingest job state)
- [x] KV namespace `CACHE` (`0c856163da…`)
- [x] Worker deployed → **https://dordekha.shouroveh9.workers.dev**
- [x] Cron trigger `* * * * *` — the per-minute heartbeat that drives the ingest
- [x] Secrets: `TELEGRAM_BOT_TOKEN`, `ADMIN_TOKEN` (local copy in `.dev.vars`, git-ignored)
- [x] `SITE_ORIGIN` set to the real origin (the workers.dev hostname, not a pages.dev one)
- [!] Telegram: bot `@dordekha_bazar_bot` created; **still needs to be added as an administrator of `@dordekha_bazar`**
- [ ] Domain (from revenue): `.cc` ≈ $8 at Cloudflare Registrar
- [ ] R2 bucket — the free plan has no buckets, so raw archiving is disabled (not required)

### Production bugs found and fixed (none of them appeared locally)
1. **KV is eventually consistent** — the ingest job state moved to D1, so the next step always sees the previous one.
2. **A Worker cannot fetch its own workers.dev hostname** — the edge rejects the subrequest with error 1042 before the code runs.
3. **A `SELF` service binding is not a fix** — children are cancelled together with their parent, producing a storm of cancelled requests.
4. **Subrequest depth limit (16 Workers stages)** — a chained self-call design can never exceed 16 steps.
   → Final design: a per-minute cron reads the job position from D1 and processes one batch per tick. No self-calls at all.
5. **Stale job blocks restarts** — a job stuck in "running" made every later start a no-op. Added staleness detection and recovery.
6. **`price_latest` was only refreshed at the end of a date** — the site looked empty for 16 minutes. Now refreshed after every batch.
7. **Non-ASCII HTTP header** — the Bangla source name in a response header threw inside the error handler, masking every real error as an empty 500.

## Phase 3 — Distribution (all autonomous once deployed)
- [ ] MCP Registry publish · Anthropic Connectors Directory · ChatGPT App Directory
- [ ] `index.parallel.ai` enrolment · Perplexity `publishers@perplexity.ai`
- [ ] Cloudflare Pay Per Use (Ceramic.ai / You.com) + Stripe Connect
- [ ] `data.gov.bd` listing · Wikidata item · Bangla Wikipedia (needs 1 independent secondary source)
- [ ] Search Console + "Search generative AI features" opt-in
- [ ] Audit Cloudflare AI Crawl Control defaults (Sept 15 2026 default blocks Googlebot on ad pages)
- [ ] B2B cold-outreach autopilot (40–100 prospects, personalised Bangla)
- [ ] Telegram daily digest + price-threshold alerts ← needs the bot as channel admin

## Phase 4 — Monetisation
- [ ] Lemon Squeezy store (global) + bKash merchant (BD) + Payoneer
- [ ] Licence keys + server-side metering (MCP `x-mcp-header` SEP-2243)
- [ ] Tiers: free · commercial licence ৳2–8k/mo · API $49–199/mo · alerts ৳500–1k/mo · bulk export one-off
- [ ] Proprietary layer: index, volatility, cross-district spread, anomaly detection

## Gates (must pass before building the paid tier)
- [ ] **G-0.5a Citation Proof** — a real AI assistant cites us with a clickable link
- [ ] **G-0.5b Licence** — DAM/ডিসিম written data licence or defensible derivative position
- [ ] **G-0.5c Buyer** — ≥1 customer pays

## Integrity review (Oct 2026) — findings and fixes
An assistant audited the live site against the government source. Every claim was
checked against the database first; these were true and are now fixed.

| # | Finding | Fix |
|---|---|---|
| 1 | A requested date was stamped onto a **different day's** figures | Date looked up in the history; a date we do not hold gets an explicit "no figure" page listing the dates we do hold. Regression guard in the e2e suite. |
| 2 | Wholesale was labelled **"per quintal"** while the number was per kilogram | The value is divided to the retail unit, so the retail unit is the label; the upstream's unit is kept separately for audit (migration 0003) |
| 3 | The movers board published **data-entry errors as market news** (a 97% fall) | Rows the upstream flagged, and moves over 100%, are excluded |
| 4 | The national aggregate was stored as **district 0** and rendered as "0" — it was the largest "district" in the database | Named "জাতীয়" and excluded from every district query |
| 5 | llms.txt claimed **16 months** while 3 days were held | The claim is computed from the database and states what is actually held |
| 6 | "আজকের" was a promise the data could not keep (the source reports T-1) | The date and the source's one-day lag are stated under the headline |
| 7 | `source.url` pointed at an **API endpoint**, not the government report | Points at the DAM report page, with the API alongside it |
| 8 | `/health` **leaked the internal pipeline state** publicly | Public health returns only what a monitor needs; detail moved behind the admin path |

## Multi-AI audit (21 Oct 2026) — 36 findings, all verified, all fixed

Four independent auditors were given the site and the audit prompts in
`docs/AUDIT-PROMPTS.md`. Their reports are in
`docs/Audit-Prompts report by multipul ai.txt`. The deepest of them found
**36 numbered findings**; a machine-checked harness (`tools/verify-audit.mjs`)
now proves **31/31 of the testable claims** hold, alongside 60/60 end-to-end
checks, 75/75 unit tests and 12/12 render checks.

**The root cause of the worst one.** The tools answered with 17 October while
the pages showed 19 October — *the same commodity, the same district, two
numbers*. The cause was the materialised `price_latest` table: an ingest that
is interrupted half way through a multi-day sweep leaves it holding an **older**
date, and every endpoint that read it published that older figure. The fix is
structural, not cosmetic: `refreshLatestFor` may now only move that table
**forward in time** (`WHERE excluded.price_date > price_latest.price_date`), and
the KV snapshot is built from the newest row per key rather than from whatever
the table happened to contain.

**What else was wrong, and what fixed it**

| Finding | Fix |
|---|---|
| The tools ignored their own `date` parameter | One function (`resolveFact`) decides the date and reads that date's row; the page, the REST API and the MCP all go through it |
| `verify_claim` called a **correct** claim false, because it silently picked one onion variety | Every variety the claim names is checked; the one whose range contains the figure is named, and the others are listed with their ranges |
| An English district name in a claim never matched | The head-word guard excluded the exact match it was meant to protect |
| "গড়" was a **mislabel** — the source's figure is (min+max)/2 in 99% of rows | Published as "মধ্যম-পরিমাণ", with `is_midpoint` on every row and the explanation in the methodology |
| `min ≤ avg ≤ max` was broken in ~10% of rows | Out-of-range figures are clamped, the row is flagged, and the source's own value is kept in `source_avg`; a source range with min > max is swapped and marked |
| Two pages published **two different** carry-forward rates (80.9% and 54%) | The rate is counted from the data at request time; both pages now show the same number |
| The dataset page claimed **505 upazilas** and **16 months** it did not have | Both are counted; the upazila line says the data is not there |
| `/methodology.md` returned **22 KB of HTML** to an assistant that asked for markdown | The content pages are one data model rendered three ways — HTML, markdown, JSON — so they cannot drift apart |
| `/api/v1/latest` without a district silently returned **Dhaka** | The district is required; a name works as well as an id; an unknown one is a 400 |
| The REST API handed out `unit: 2` with **no legend** | `/api/v1/units` publishes the code-to-unit mapping, and the methodology page prints it |
| The `divisor` was a **hard-coded 100** on every row | The snapshot carries the divisor and its source that the ingest actually recorded (100, 25, 20 …) |
| The sitemap advertised **none** of the citable per-fact URLs | It is now an index, with the dated fact pages in `sitemap-facts-*.xml` (3,998 of them) |
| There was **no `:focus-visible`**, no `scope`, and no mobile menu | Added, with a skip link already in place |
| The MCP cache hint said **1 hour** while the HTTP header said 10 minutes | Both are 10 minutes now |
| Internal D1 detail leaked in 500 responses | The detail is logged, not published; the client gets a stable 503 shape |

**New tools:** `tools/verify-audit.mjs` (the 31 claims), `tools/check-structure.mjs`
(page structure), `tools/probe-mcp.mjs` and `tools/probe-resolve.mjs` (matching
probes), `tools/parse-audit.mjs` + `tools/extract-findings.mjs` (turn the
reviewers' prose into a checklist), and `test/audit-fix.test.ts` (regression
tests, one per finding).

### The constraint the review exposed
D1's free tier allows **100,000 rows written per day** and **5,000,000 rows read per day**. A 16-month
backfill is ~700,000 rows, and the old ingest was spending the whole write budget rewriting the
snapshot table on every call (423,533 rows over 119 calls). The ingest now collects only the report
days it is missing, refreshes the snapshot for the districts it wrote, and stops itself at 80,000
rows a day rather than locking the database out until midnight UTC.

### The constraint the read limit exposed
The read budget ran out within hours, because the read patterns were full table scans: `MAX(price_date)`
over the fact table, a `GROUP BY` over the whole snapshot table for the busiest district, and `COUNT`
over everything for the statistics strip. When the budget ran out, **every page answered 500** — and
for a price service that looks exactly like the data has been lost.

Three changes made the site survive it:

1. **The missing indexes** (migration `0004_indexes.sql`). `price_latest` had no index on
   `commodity_id`, so "every district's price for this commodity" scanned the whole table.
2. **The daily aggregates are cached in KV** — latest date, row counts, how far back the history
   reaches, the busiest district, the carried-forward share. They change at most once a day and were
   being recomputed on every request.
3. **The current prices, the price history and the reference data are also snapshotted in KV**, and
   every read path falls back to them when the database cannot be read. The site degrades to
   slightly stale data instead of to nothing.

Verified: **58 of 58 end-to-end checks pass with the database completely unreadable.**

> ⏳ **Pending:** migration `0004_indexes.sql` cannot be applied until the daily read budget resets
> (midnight UTC). Until then the site runs on the cached snapshot and the indexes are not yet in
> place, so the read budget stays tight. Run
> `npx wrangler d1 migrations apply dordekha --remote` after the reset.
> The snapshot is rebuilt after each ingest, so once the budget resets the database-backed path
> takes over and the cache becomes the fallback rather than the primary.

**Consequence:** the history grows by roughly 20 report days a day, and the site's claim about it
is computed, never asserted. The full upstream archive is reachable but is not yet held here.

## Kill switch
If 6 months pass with <3 paying customers ⇒ wind down cleanly, export data, keep the open dataset.

---

## Human action checklist
(only these; everything else is the agent's job)
1. [ ] **Create a Cloudflare account** → `docs/DEPLOY-BN.md` step 1  ← *start here*
2. [ ] Telegram: BotFather token + channel @username
3. [ ] bKash personal number (for receiving payments)
4. [ ] Sign + send the DAM/ডিসিম data-licence letter (agent drafts it)
5. [ ] One Facebook-group post per week (agent writes the text)
6. [ ] Confirm 2–5 incoming payments per month (agent lists amount + txn id)
