# Run plan — 2026-10-21 autonomous run

> দরদেখা — autonomous operator run. Owner is a viewer; every decision is mine.
> Source of truth: `PLAN.md`, `docs/FAILURE-MODES.md`, `docs/MASTER-PROMPT.md`.
>
> **Why this run exists.** The per-minute cron tick was scanning `price_daily`
> in full on every tick (`historyRange` → `COUNT(DISTINCT price_date)`, and
> `previousValues` → one un-indexed subquery per district). Measured on
> 2026-10-21: `price_daily` = 11,594 rows → 11,594 rows/tick × 1,440
> ticks/day ≈ **16.7M rows/day against a 5M/day budget**; during an ingest
> job ≈ 83M/day. The D1 read quota was exhausted by 14:04 UTC, and the
> `history:snapshot` KV key (1.92 MB, 3 dates) had fallen behind the
> database (4 dates) because nothing rebuilds it but a manual upload.
>
> The consequence is not "the site is slow": the site's claim about how far
> back its history reaches is computed from data the quota no longer allows
> it to read, so the claim silently freezes at 3 days. A price service that
> understates its own history is a data-integrity failure (rule 1 and rule 2
> of the inviolable rules).

## Global constraints

- **Zero spend.** Free tiers only. No domain purchase, no paid API, no paid plan.
- **Never fabricate a number.** Every published figure is computed from data.
- **Never move a date.** `price_date` is the published date, always.
- **Cache-first.** Every read path reads KV first; D1 is the fallback, never
  the first choice. The D1 read budget is 5,000,000 rows/day and it is
  already spent.
- **Every API result carries** `price_date`, `unit_bn`, and a citable `url`.
- One date-resolution function (`resolveFact`) serves every path.
- Owner jobs stay minimal: GitHub publish, licence signature, weekly Facebook
  post, email path, payment confirmation.

## Pre-flight: shared interfaces

| Producer | Consumer | Finding |
|---|---|---|
| `cronTick` (ingest.ts) | `historyRange` (db.ts) | `cronTick` called `historyRange` on **every** tick, including idle ones. Interface is fine; the *call site* is the bug. |
| `cronTick` → `advance` | `previousValues` (db.ts) | `advance` called `previousValues` **once per district** (4 full scans/tick). Needs a batched variant. |
| `computeAggregatesFromCache` (cache.ts) | `getHistorySnapshot` (cache.ts) | Aggregates derive `days`/`firstDate`/`rowCount` from the KV history. If the history is not maintained, the aggregates freeze. |
| `historyFor` (db.ts) | `api/v1/history` + MCP `get_price_trend` | Reads D1 with no supporting index → a single trend call scans the whole table. |
| `license` + `usage_event` tables (migration 0001) | nothing in `src/` | The tables exist; **no code uses them**. The paid tier is entirely unimplemented. |

Pre-flight ruling: the D1 tables for the paid tier already exist, so no
migration is needed for Task 3.

---

## Task 1: Stop the read bleed

**Goal:** an idle cron tick must cost ~0 D1 rows, and an active tick must
cost one batched query instead of four full scans.

**Interfaces**
- Produces: `historyRangeCached(env)` in `src/cache.ts` — the history range
  from the cached aggregates, with a D1 fallback only when the cache is cold.
- Produces: `previousValuesForDistricts(db, districtIds, beforeDate)` in
  `src/db.ts` — one query for a whole batch.
- Consumes: `getAggregates` (exists), `previousValues` (kept for compatibility).

**Steps**

1. Write the failing test — `test/quota.test.ts`:
   - A fake D1 that records every SQL statement it is given.
   - Case 1: `cronTick` with no job in state and a warm cache must issue
     **zero** statements mentioning `price_daily`.
   - Case 2: `cronTick` with a running job must issue **at most one**
     statement mentioning `price_daily` for the whole batch (not one per
     district).
   - Case 3: `historyRangeCached` returns the same `first`/`last`/`days` as
     `historyRange` for the same data.
   - Run it — expect failure. **Expected:** the fake records a `COUNT(DISTINCT
     price_date)` against `price_daily` on an idle tick.
2. Implement:
   - `src/cache.ts`: `historyRangeCached(env)` — read the cached aggregates
     (`days`, `firstDate`, `latestDate`); on a cache miss, fall back to
     `historyRange(env.DB)` and cache the result.
   - `src/db.ts`: `previousValuesForDistricts(db, districtIds, beforeDate)` —
     a single statement with `district_id IN (…)` and the previous date
     resolved once.
   - `src/ingest.ts`: `cronTick` uses `historyRangeCached`; `advance` uses
     `previousValuesForDistricts` for the whole batch.
3. Run the test — **Expected:** all cases pass.
4. Run the whole suite: `npx vitest run` — **Expected:** 75 + new tests pass.
5. Run `npx tsc --noEmit` — **Expected:** no output.
6. Commit: `fix(quota): the cron tick no longer scans the price table`.

---

## Task 2: The history cache becomes a first-class store

**Goal:** the KV history is maintained by the ingest, sharded so it can never
hit the 25 MB value limit, and the read paths (trend, aggregates) use it.

**Interfaces**
- Produces: `setHistoryDate(env, date, rows)`, `getHistoryDates(env)`,
  `getHistoryForDate(env, date)`, `getHistoryRows(env, commodityId, districtId)`
  in `src/cache.ts`.
- Consumes: `getHistorySnapshot` — kept, now sharded, with the legacy
  single-key form as a fallback.
- Produces: `historyForCached(env, commodityId, districtId)` used by the API
  and the MCP trend tool, with the D1 query as its fallback.

**Steps**

1. Write the failing test — `test/history-cache.test.ts`:
   - Round-trip: three dates of rows written with `setHistoryDate` are read
     back by `getHistoryForDate` unchanged and in order.
   - Sharding: a date's rows are spread over more than one key when they
     exceed the per-shard row limit, and reassembly is exact.
   - The manifest lists every date and the total row count.
   - Legacy fallback: with only the old `history:snapshot` key present, the
     reader still returns its rows.
   - A single key never exceeds the configured shard size.
   - Run it — expect failure. **Expected:** `setHistoryDate` is not exported.
2. Implement in `src/cache.ts`:
   - `history:date:<date>:<n>` shards, `history:index` manifest holding the
     date list and the row count.
   - `getHistoryRows(env, commodityId, districtId)` — reads the shards for
     the dates it needs, filters, and returns the series; the D1 query stays
     as the fallback.
   - `computeAggregatesFromCache` derives `days`/`firstDate`/`rowCount` from
     the manifest and the latest snapshot.
3. Wire the ingest: at the end of each report date, write that date's rows
   into the shards (one read of that date from D1, then the write).
4. Wire the readers: the API history endpoint and the MCP `get_price_trend`
   use `getHistoryRows` first.
5. Run the test — **Expected:** all cases pass.
6. Run `npx vitest run` and `npx tsc --noEmit` — **Expected:** green, clean.
7. Commit: `feat(history): shard the history cache and maintain it from the ingest`.

---

## Task 3: The paid tier, first slice

**Goal:** there is something to sell the moment the licence arrives — an API
key, a rate limit, a quota, and a usage view. No payment integration, no
spend.

**Interfaces**
- Produces: `src/keys.ts` — `generateApiKey`, `hashApiKey`, `verifyLicense`,
  `recordUsage`, `enforceAccess`.
- Consumes: the `license` and `usage_event` tables (migration 0001).
- Produces: `POST /internal/license/create`, `GET /internal/license/list`
  (admin token), `GET /api/v1/account` (the key holder).
- The `license` lookup is **cache-first**: `lic:<hash>` in KV, D1 as the
  fallback — an API call must never cost a database read it does not need.

**Steps**

1. Write the failing test — `test/keys.test.ts`:
   - `generateApiKey()` returns a prefixed key of at least 32 bytes of entropy,
     and two calls never collide.
   - `hashApiKey()` is a stable 64-character hex SHA-256; the same key always
     hashes the same; the raw key never appears in the stored record.
   - `planLimits(plan)` returns the rate limit and the quota for each plan.
   - `checkQuota(license, now)` distinguishes ok / expired / exhausted.
   - `enforceAccess` rejects an unknown key, an expired key and an exhausted
     key, and accepts a live one.
   - Run it — expect failure. **Expected:** `src/keys.ts` does not exist.
2. Implement `src/keys.ts`:
   - `dk_live_` + 32 random bytes, base64url.
   - SHA-256 via WebCrypto, hex encoded.
   - `verifyLicense(env, key)` — KV first, D1 fallback, cached under
     `lic:<hash>`.
   - `enforceAccess(env, request, endpoint, source)` — reads the key from
     `Authorization: Bearer …` or `X-API-Key`, returns the licence and the
     reason for a refusal.
   - `recordUsage(env, licenceId, endpoint, source, status)` — one row per
     call, written in a batch with the counter update.
3. Add the routes to `src/index.ts`:
   - `POST /internal/license/create` — creates a licence, returns the raw key
     **once**, stores only the hash.
   - `GET /internal/license/list` — the licences without the raw key.
   - `GET /api/v1/account` — the key holder's own plan, usage and limit.
4. Apply the key to `/api/v1/*` and `/mcp`:
   - No key → the current free behaviour, unchanged (the citation surface
     must not break).
   - A key that is present but invalid, expired or over quota → `401`/`429`
     with a message that says what to do.
   - Every call records a usage event.
5. Run the test — **Expected:** all cases pass.
6. Run `npx vitest run`, `npx tsc --noEmit`, then `node tools/e2e.mjs` with
   `BASE` set to the deployed site — **Expected:** green, clean, 60/60.
7. Commit: `feat(licence): API keys, rate limits, quota and a usage view`.

---

## Review focus

The reviewer's attention should go to the input classes these tests do not
exercise:

- A D1 read error in the middle of a tick (the quota is exhausted today —
  this is not hypothetical).
- KV eviction between the manifest and its shards.
- A key presented with the wrong prefix, the wrong case, or trailing
  whitespace.
- A quota that resets across a day boundary.
- Two concurrent calls racing on `calls_used`.
- A shard index that references a shard that does not exist.
