/**
 * Ingest pipeline.
 *
 * HOW THE JOB IS DRIVEN
 * ---------------------
 * The ingest runs on a per-minute cron trigger. Every tick reads the job
 * position from D1, processes one batch of districts, and writes the new
 * position back. D1 is used rather than KV because KV is eventually
 * consistent and the next tick must always see the previous one.
 *
 * Two earlier designs were tried and both failed in production:
 *
 *  - A Worker fetching its own workers.dev hostname: the edge rejects the
 *    subrequest with error 1042 before the code ever runs.
 *  - A `SELF` service binding: the call goes through, but every child
 *    request is cancelled together with its parent, which produced a storm
 *    of cancelled requests instead of a chain.
 *
 * A cron-driven job has neither problem, and it is easier to reason about:
 * if a tick is lost, the next one simply continues from the stored
 * position.
 *
 * CPU is the other constraint. On the free plan a cron trigger gets ~10 ms
 * of CPU, so each tick handles a small number of districts. Waiting for I/O
 * does not count against the CPU budget, only the JSON parsing does.
 */

import { fetchMasterData, fetchDailyPrices, fetchNationalScroll } from "./moa";
import { normalizeBatch, type RawUpstreamRow } from "./normalize";
import {
  historyRange,
  previousValuesForDistricts,
  readJob,
  recordIngestRun,
  refreshLatestFor,
  replaceMasterData,
  upsertPrices,
  writeJob,
} from "./db";
import { getAggregates, getMasterSnapshot, getSnapshot, setMasterSnapshot, toMasterSnapshot } from "./cache";
import { hasRequiredIndexes } from "./maintenance";
import { notifyIndexNow } from "./indexnow";
import { commoditySlug, districtSlug } from "./slug";
import type { Env, MasterData, PriceRecord } from "./types";

/**
 * Find the dates the upstream actually has figures for.
 *
 * The archive reaches back roughly sixteen months. Probing every candidate
 * date costs one request each, which is cheap next to a backfill of
 * thousands of district-days.
 */
/**
 * The candidate dates for a backfill.
 *
 * Not every day has a report — Fridays and Saturdays are often empty — so
 * the list is the calendar rather than a probe of every day. Probing 120
 * days one request at a time would time the request out, and the ingest
 * handles an empty day perfectly well on its own.
 */
async function findDatesWithData(env: Env, lookbackDays: number): Promise<string[]> {
  void env;
  const dates: string[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.reverse();
}

/** How many days of history to keep in the database. */
export const HISTORY_DAYS = 120;

const JOB_KEY = "ingest:job";
const MASTER_KEY = "ingest:master";
const MASTER_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Districts handled per cron tick. */
const DISTRICTS_PER_STEP = 4;

/** How long a job may sit without progress before it is considered dead. */
const STALE_AFTER_MS = 10 * 60 * 1000;

/** A new ingest is started when the last completed report is this old. */
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;

export interface IngestJob {
  id: string;
  kind: "daily" | "backfill";
  priceDates: string[];
  dateIndex: number;
  districtIndex: number;
  districts: number[];
  rowsWritten: number;
  districtsOk: number;
  districtsMissing: number;
  startedAt: string;
  /** Last time the job made progress. */
  updatedAt: string;
  steps: number;
  status: "running" | "done" | "failed";
  error?: string;
}

/** Hands a background promise to the runtime so it survives the response. */
export type Defer = (fn: () => Promise<unknown>) => void;

function isStale(job: IngestJob): boolean {
  const last = Date.parse(job.updatedAt || job.startedAt || "");
  if (Number.isNaN(last)) return true;
  return Date.now() - last > STALE_AFTER_MS;
}

/** Master data is stable for months; cache it so ingest does not refetch it. */
async function getMaster(env: Env, force = false): Promise<MasterData> {
  if (!force) {
    const cached = await env.CACHE.get(MASTER_KEY, "json");
    if (cached) return cached as MasterData;
  }
  const master = await fetchMasterData({ baseUrl: env.SOURCE_API });
  await env.CACHE.put(MASTER_KEY, JSON.stringify(master), { expirationTtl: MASTER_TTL_SECONDS });
  return master;
}

/**
 * Find the recent dates to (re)collect.
 *
 * The two most recent report days are always re-collected, because the
 * upstream sometimes corrects a figure after publishing it. Anything older
 * that we already hold is skipped — re-fetching it would burn the write
 * budget for nothing.
 *
 * Returned oldest-first: carry-forward detection compares a day against the
 * day before it, so the earlier day must already be in the database.
 */
async function targetDates(env: Env, lookbackDays: number): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < lookbackDays && found.length < 2; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const ymd = d.toISOString().slice(0, 10);
    const rows = await fetchDailyPrices({ priceDate: ymd, districtId: 47 }, { baseUrl: env.SOURCE_API });
    if (rows.length > 0) found.push(ymd);
  }
  return found.reverse();
}

/* ── Daily write budget ─────────────────────────────────────────────────── */

/**
 * D1's free tier allows 100,000 rows written per day. A backfill is hundreds
 * of thousands of rows, so the ingest has to know where it stands and stop
 * rather than lock itself out of the database until midnight UTC.
 */
const DAILY_ROW_BUDGET = 80_000;
const BUDGET_KEY = (day: string) => `ingest:budget:${day}`;
const PAUSE_KEY = "ingest:paused_until";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function budgetUsed(env: Env): Promise<number> {
  const v = await env.CACHE.get(BUDGET_KEY(today()));
  return v ? Number(v) : 0;
}

async function budgetAdd(env: Env, rows: number): Promise<void> {
  const used = (await budgetUsed(env)) + rows;
  await putQuietly(env, BUDGET_KEY(today()), String(used), 60 * 60 * 30);
}

/**
 * A cache write that must never break the tick.
 *
 * The free tier allows a thousand writes a day, and the ingest needs most
 * of them. If a write ever fails — because the budget ran out — the tick
 * has to carry on: an unguarded throw here would kill the tick, the job
 * would never advance, and the ingest would write the same four districts
 * over and over until the database's write budget went too.
 */
async function putQuietly(env: Env, key: string, value: string, ttl: number): Promise<void> {
  try {
    await env.CACHE.put(key, value, { expirationTtl: ttl });
  } catch {
    /* a cache write failure must never break a request */
  }
}

/** Is the backfill paused until tomorrow? */
export async function backfillPaused(env: Env): Promise<boolean> {
  const until = await env.CACHE.get(PAUSE_KEY);
  return Boolean(until && until > today());
}

/**
 * The marker that says the history depth was already verified today.
 *
 * The verification costs a scan of the price table, so it is worth doing
 * once a day and not once a minute.
 */
const RANGE_CHECK_KEY = (day: string) => `ingest:range-checked:${day}`;

type HistoryDecision =
  /** There is plenty of history; nothing to do. */
  | { kind: "enough" }
  /** The indexes are not in place yet, so a backfill has to wait. */
  | { kind: "wait-for-index" }
  /** The answer was already given today, or could not be read. */
  | { kind: "check-later" }
  /** The history is thinner than it should be. */
  | { kind: "thin"; days: number };

/**
 * What should the tick do about the history?
 *
 * The cached aggregates already hold how far back the history reaches, and
 * reading them is free. The index check costs a handful of rows. Only the
 * database scan is expensive, and it happens at most once a day, and only
 * when the answer could change what the tick does.
 *
 * Before this, the tick read the whole price table every minute, whether or
 * not it had any work to do. At 11,594 rows and 1,440 ticks a day that is
 * 16.7 million rows against a 5 million budget, and the quota was gone by
 * the middle of the afternoon.
 */
async function historyDecision(env: Env): Promise<HistoryDecision> {
  const cached = await getAggregates(env);
  if (cached.days >= HISTORY_DAYS * 0.8) return { kind: "enough" };

  // The index check comes before the scan, because a backfill without the
  // indexes reads the whole table for every batch of districts — and the
  // scan must not be repeated every minute while we wait for the upkeep.
  if (!(await hasRequiredIndexes(env))) return { kind: "wait-for-index" };

  const day = today();
  if (await env.CACHE.get(RANGE_CHECK_KEY(day))) return { kind: "check-later" };

  let range: { first: string | null; last: string | null; days: number };
  try {
    range = await historyRange(env.DB);
  } catch {
    // The read budget is spent. The answer is unknown, so nothing is
    // started on a guess — but the daily refresh still has work to do, and
    // the tick must not fall over. The marker is short-lived, so the
    // question is asked again in an hour rather than every minute.
    await putQuietly(env, RANGE_CHECK_KEY(day), "failed", 60 * 60);
    return { kind: "check-later" };
  }

  await putQuietly(env, RANGE_CHECK_KEY(day), "1", 60 * 60 * 48);
  if (range.days >= HISTORY_DAYS * 0.8) return { kind: "enough" };
  return { kind: "thin", days: range.days };
}

/**
 * The per-minute heartbeat. This is the only thing that drives the job in
 * production, and it is also what starts a new job when one is due.
 */
export async function cronTick(env: Env): Promise<{ action: string; job?: IngestJob }> {
  const existing = await readJob<IngestJob>(env.DB);

  if (existing && existing.status === "running") {
    if (isStale(existing)) {
      console.log(`ingest job ${existing.id} is stale — restarting it`);
      return { action: "restarted", job: await startIngest(env) };
    }
    return { action: "step", job: await advance(env, existing) };
  }

  // The history claim on the site has to be true, so when it is thinner than
  // it should be, a backfill runs before the daily refresh.
  const decision = await historyDecision(env);
  if (decision.kind === "wait-for-index") {
    // A backfill without the indexes reads the whole price table for every
    // batch of districts. It waits for them instead.
    return { action: "waiting-for-index" };
  }
  if (decision.kind === "thin" && !(await backfillPaused(env))) {
    console.log(`history is ${decision.days} days — starting a backfill`);
    return { action: "backfill", job: await startBackfill(env) };
  }
  // No job running. Decide whether a daily refresh is due.
  const last = await lastCompletedReport(env.DB);
  const age = last ? Date.now() - Date.parse(last) : Number.POSITIVE_INFINITY;
  if (age > REFRESH_AFTER_MS) {
    return { action: "started", job: await startIngest(env) };
  }
  return { action: "idle" };
}

/**
 * Collect the history the upstream holds.
 *
 * The site's claim about how far back it reaches is computed from the
 * database, so it is only ever as good as the collection actually is.
 */
export async function startBackfill(env: Env): Promise<IngestJob> {
  const master = await getMaster(env);
  const dates = await findDatesWithData(env, HISTORY_DAYS);
  console.log(`backfill: ${dates.length} dates to collect`);

  const job: IngestJob = {
    id: `backfill_${Date.now().toString(36)}`,
    kind: "backfill",
    priceDates: dates,
    dateIndex: 0,
    districtIndex: 0,
    districts: master.districts.map((d) => d.id),
    rowsWritten: 0,
    districtsOk: 0,
    districtsMissing: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: 0,
    status: "running",
  };

  await writeJob(env.DB, job);
  return advance(env, job);
}

/** Drop anything older than the history window. */
export async function pruneHistory(env: Env, keepDays = HISTORY_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
  const res = await env.DB.prepare(`DELETE FROM price_daily WHERE price_date < ?`).bind(cutoff).run();
  return res.meta?.changes ?? 0;
}

/** The most recent date that finished a full district sweep. */
async function lastCompletedReport(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT MAX(price_date) AS d FROM ingest_run WHERE scope = 'district' AND status IN ('ok','partial')`)
    .first<{ d: string | null }>();
  return row?.d ?? null;
}

/** Create a job and process its first batch. */
export async function startIngest(env: Env): Promise<IngestJob> {
  const master = await getMaster(env);
  const dates = await targetDates(env, 5);

  if (dates.length === 0) {
    console.log("no report dates available yet");
    return {
      id: "noop",
      kind: "daily",
      priceDates: [],
      dateIndex: 0,
      districtIndex: 0,
      districts: [],
      rowsWritten: 0,
      districtsOk: 0,
      districtsMissing: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: 0,
      status: "done",
      error: "no report dates available",
    };
  }

  const job: IngestJob = {
    id: `job_${Date.now().toString(36)}`,
    kind: "daily",
    priceDates: dates,
    dateIndex: 0,
    districtIndex: 0,
    districts: master.districts.map((d) => d.id),
    rowsWritten: 0,
    districtsOk: 0,
    districtsMissing: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: 0,
    status: "running",
  };

  await writeJob(env.DB, job);
  await recordIngestRun(env.DB, {
    priceDate: dates[0]!,
    scope: "district",
    startedAt: job.startedAt,
    status: "running",
  });

  return advance(env, job);
}

/** Process one batch of districts and write the new position back. */
export async function advance(env: Env, job: IngestJob): Promise<IngestJob> {
  const current = job.priceDates[job.dateIndex];
  if (!current) {
    job.status = "done";
    await writeJob(env.DB, job);
    return job;
  }

  const startedAt = new Date().toISOString();
  const batch = job.districts.slice(job.districtIndex, job.districtIndex + DISTRICTS_PER_STEP);

  // Respect the daily write budget before spending it. This applies to every
  // kind of job: the free tier allows 100,000 rows written per day, and a
  // backfill is hundreds of thousands. Running past it locks the database
  // out until midnight UTC, which would also stop the daily refresh.
  if ((await budgetUsed(env)) >= DAILY_ROW_BUDGET) {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await env.CACHE.put(PAUSE_KEY, tomorrow, { expirationTtl: 60 * 60 * 48 });
    job.status = "done";
    job.error = "দৈনিক রাইট বাজেট পূর্ণ — আগামীকাল থেকে চালু হবে";
    await writeJob(env.DB, job);
    console.log("ingest paused: daily row-write budget reached");
    return job;
  }

  const results = await Promise.all(
    batch.map(async (districtId) => {
      try {
        const rows = await fetchDailyPrices({ priceDate: current, districtId }, { baseUrl: env.SOURCE_API });
        return { districtId, rows, error: null as string | null };
      } catch (err) {
        return { districtId, rows: [] as RawUpstreamRow[], error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const records: PriceRecord[] = [];
  let ok = 0;
  let missing = 0;

  // One statement for the whole batch, not one per district.
  const districtsWithRows = results
    .filter((r) => r.error === null && r.rows.length > 0)
    .map((r) => r.districtId);
  const previousByDistrict = await previousValuesForDistricts(env.DB, districtsWithRows, current);

  for (const res of results) {
    if (res.error) {
      missing++;
      console.error(`district ${res.districtId} failed: ${res.error}`);
      continue;
    }
    if (res.rows.length === 0) {
      missing++;
      continue;
    }
    ok++;
    const prevMap = previousByDistrict.get(res.districtId) ?? new Map();
    records.push(
      ...normalizeBatch(res.rows, { priceDate: current, districtId: res.districtId, upazilaId: null }, prevMap),
    );
  }

  if (records.length > 0) {
    const written = await upsertPrices(env.DB, records);
    job.rowsWritten += written;
    await budgetAdd(env, written * 2); // the fact table and the snapshot table
    // Refresh the read path for exactly the districts we just wrote.
    await refreshLatestFor(
      env.DB,
      current,
      results.filter((r) => r.error === null && r.rows.length > 0).map((r) => r.districtId),
    );
  }
  job.districtsOk += ok;
  job.districtsMissing += missing;
  job.districtIndex += batch.length;
  job.steps++;
  job.updatedAt = new Date().toISOString();

  if (job.districtIndex >= job.districts.length) {
    await recordIngestRun(env.DB, {
      priceDate: current,
      scope: "district",
      startedAt,
      finishedAt: new Date().toISOString(),
      rowsWritten: records.length,
      districtsOk: ok,
      districtsMissing: missing,
      status: missing === 0 ? "ok" : "partial",
    });
    // Publish the daily digest to Telegram, once the date is complete.
    try {
      const { publishDigest } = await import("./telegram");
      const digest = await buildDigestInput(env, current);
      if (digest.masterEmpty) {
        // The master data was being replaced while the sweep finished. The
        // digest would say "no figures" on a day that has them, and it
        // would never be sent again.
        console.log(`digest skipped for ${current}: the catalogue is being replaced`);
      } else {
        const res = await publishDigest(env, digest);
        if (res.sent) console.log(`digest published for ${current}`);
        else if (res.error) console.log(`digest skipped: ${res.error}`);
      }
    } catch (err) {
      console.error("digest failed", err);
    }
    // The pages for this date exist now, so the engines that accept
    // IndexNow can be told about them.
    try {
      const { writeSnapshot } = await import("./cache");
      await writeSnapshot(env);
      await notifyNewUrls(env, current);
    } catch (err) {
      console.error("indexnow notification failed", err);
    }
    job.dateIndex++;
    job.districtIndex = 0;
  }

  if (job.dateIndex >= job.priceDates.length) {
    job.status = "done";
    await writeJob(env.DB, job);
    // Keep the cached aggregates and the fallback snapshot current.
    try {
      const { refreshAggregates, writeSnapshot } = await import("./cache");
      await writeSnapshot(env);
      await refreshAggregates(env);
    } catch (err) {
      console.error("cache refresh failed", err);
    }
    await backfillNational(env, job);
    console.log(`ingest job ${job.id} finished: ${job.rowsWritten} rows`);
    return job;
  }

  await writeJob(env.DB, job);
  return job;
}

/** Process exactly one batch on demand (used by the admin endpoint). */
export async function stepIngest(env: Env): Promise<IngestJob> {
  const job = await readJob<IngestJob>(env.DB);
  if (!job) throw new Error("no ingest job in state");
  if (job.status !== "running") return job;
  if (isStale(job)) {
    console.log(`ingest job ${job.id} is stale — restarting from the current position`);
    return startIngest(env);
  }
  return advance(env, job);
}

/**
 * Store the national scroll series as a coarse fallback so that a district
 * missing on a given day still has a national reference point.
 */
async function backfillNational(env: Env, job: IngestJob): Promise<void> {
  try {
    const rows = await fetchNationalScroll({ baseUrl: env.SOURCE_API });
    const master = await getMaster(env);
    const byId = new Map(master.commodities.map((c) => [c.id, c]));
    const records: PriceRecord[] = [];
    for (const r of rows) {
      const c = byId.get(r.commodity_id);
      if (!c) continue;
      const priceDate = r.price_date;
      if (!priceDate) continue;
      const retail = Number(r.a_r_lowestPrice);
      const retailMax = Number(r.a_r_howestPrice);
      const wholesale = Number(r.a_w_lowestPrice);
      const wholesaleMax = Number(r.a_w_howestPrice);
      records.push({
        priceDate,
        districtId: 0, // 0 = national aggregate
        upazilaId: 0,
        commodityId: r.commodity_id,
        commodityGroupId: c.groupId,
        commoditySubGroupId: c.subGroupId,
        retail: {
          min: Number.isFinite(retail) ? retail : null,
          max: Number.isFinite(retailMax) ? retailMax : null,
          avg: Number.isFinite(retail) ? retail : null,
          unitId: c.unitRetail ?? 2,
          rawUnitId: c.unitRetail ?? 2,
          divisor: 1,
          divisorSource: "table",
        },
        wholesale: Number.isFinite(wholesale)
          ? {
              min: Math.round((wholesale / 100) * 100) / 100,
              max: Number.isFinite(wholesaleMax) ? Math.round((wholesaleMax / 100) * 100) / 100 : null,
              avg: Math.round((wholesale / 100) * 100) / 100,
              unitId: c.unitRetail ?? 2,
              rawUnitId: 1,
              divisor: 100,
              divisorSource: "table",
            }
          : null,
        carriedForward: false,
        anomaly: null,
      });
    }
    if (records.length > 0) {
      await upsertPrices(env.DB, records);
      await recordIngestRun(env.DB, {
        priceDate: job.priceDates[job.priceDates.length - 1] ?? new Date().toISOString().slice(0, 10),
        scope: "national",
        startedAt: job.startedAt,
        finishedAt: new Date().toISOString(),
        rowsWritten: records.length,
        districtsOk: 1,
        districtsMissing: 0,
        status: "ok",
      });
    }
  } catch (err) {
    await recordIngestRun(env.DB, {
      priceDate: new Date().toISOString().slice(0, 10),
      scope: "national",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Tell the search engines that a day's pages now exist.
 *
 * A site with no external links is not found by being crawled. The
 * engines that accept IndexNow put the URLs into their crawl queue at
 * once. Google does not accept it — for Google the path is links and
 * Search Console — so this is a floor, not the whole answer.
 */
async function notifyNewUrls(env: Env, priceDate: string): Promise<void> {
  const [master, snapshot] = await Promise.all([getMasterSnapshot(env), getSnapshot(env)]);
  if (!master || !snapshot) return;

  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  const urls: string[] = [];
  for (const row of snapshot.rows) {
    if (row.t !== priceDate) continue;
    const c = master.commodities.find((x) => x.id === row.c);
    const d = master.districts.find((x) => x.id === row.d);
    if (!c || !d) continue;
    urls.push(
      `${origin}/price/${commoditySlug(c.nameBn, c.nameEn, c.id)}/${districtSlug(d.nameBn, d.nameEn, d.id)}/${priceDate}`,
    );
  }
  if (urls.length === 0) return;
  const result = await notifyIndexNow(env, urls);
  console.log(
    `indexnow: ${result.sent ? "sent" : "not sent"} ${result.count} URLs for ${priceDate} (${result.status})`,
  );
}

/**
 * Assemble the digest input for one report date: the rows for the headline
 * commodities, ready to be turned into a message.
 */
export async function buildDigestInput(env: Env, priceDate: string) {
  // The master data is replaced by deleting and re-inserting it, so for a
  // moment the catalogue is empty. A digest built in that moment would say
  // "no figures today" on a day that has figures, and it would never be
  // sent again. So the moment is detected.
  const catalogue = await env.DB.prepare(`SELECT COUNT(*) AS c FROM commodity`).first<{ c: number }>();
  const masterEmpty = (catalogue?.c ?? 0) === 0;

  const { results: cs } = await env.DB
    .prepare(`SELECT id, name_bn FROM commodity WHERE name_bn IN (?,?,?,?,?,?)`)
    .bind("পেঁয়াজ", "চাল", "আলু (দেশীয়)", "ডিম ফার্ম- লাল", "তৈল- সরিষা-দেশীয় -সাধারণ", "ডাল")
    .all();

  const featured = (cs ?? []).map((c) => String((c as Record<string, unknown>).name_bn ?? "")).filter(Boolean);

  const { results: rows } = await env.DB
    .prepare(
      `SELECT c.name_bn AS commodity, d.name_bn AS district,
              p.retail_min, p.retail_max, p.retail_avg, p.wholesale_avg,
              p.carried_forward, u.name_bn AS unit
         FROM price_latest p
         JOIN commodity c ON c.id = p.commodity_id
         JOIN district d ON d.id = p.district_id
         LEFT JOIN unit u ON u.id = p.retail_unit
        WHERE p.price_date = ? AND p.upazila_id = 0`,
    )
    .bind(priceDate)
    .all();

  const digestRows = (rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      commodityBn: String(row.commodity ?? ""),
      districtBn: String(row.district ?? ""),
      retail: {
        min: (row.retail_min as number | null) ?? null,
        max: (row.retail_max as number | null) ?? null,
        avg: (row.retail_avg as number | null) ?? null,
        unitBn: String(row.unit ?? "কেজি"),
      },
      wholesale: { avg: (row.wholesale_avg as number | null) ?? null },
      carriedForward: Number(row.carried_forward) === 1,
    };
  });

  return {
    date: priceDate,
    rows: digestRows,
    origin: env.SITE_ORIGIN.replace(/\/$/, ""),
    sourceName: env.SOURCE_NAME,
    featured,
    masterEmpty,
  };
}

/** Refresh the master data. The worker runs this once a day, after the
 *  D1 read quota resets. */
export async function refreshMaster(env: Env): Promise<{ districts: number; upazilas: number; commodities: number }> {
  const master = await fetchMasterData({ baseUrl: env.SOURCE_API });
  await replaceMasterData(env.DB, master);
  await env.CACHE.put(MASTER_KEY, JSON.stringify(master), { expirationTtl: MASTER_TTL_SECONDS });
  // The cached snapshot is what the read paths actually use. A refresh that
  // updated only the database left the site publishing whatever the stale
  // snapshot said — an empty group and a null wholesale unit for every
  // commodity — while the database held the right values.
  await setMasterSnapshot(env, toMasterSnapshot(master));
  return {
    districts: master.districts.length,
    upazilas: master.upazilas.length,
    commodities: master.commodities.length,
  };
}
