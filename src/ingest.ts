/**
 * Ingest pipeline.
 *
 * WHY THIS IS A SELF-CHAINING HTTP JOB
 * ------------------------------------
 * On the Workers Free plan a Cron Trigger gets ~10 ms of CPU. Fetching and
 * parsing 64 district responses in one invocation would blow that budget
 * (JSON.parse alone costs ~20 ms for the full day).
 *
 * CPU time only accrues while code is actually running, not while awaiting
 * I/O — so the trick is to make each invocation tiny and let the job call
 * itself for the next batch. The cron trigger starts the chain; every step
 * handles a handful of districts and hands off.
 *
 * State lives in KV so a crash mid-chain resumes rather than restarts.
 */

import { fetchMasterData, fetchDailyPrices, fetchNationalScroll } from "./moa";
import { normalizeBatch, type RawUpstreamRow } from "./normalize";
import { previousValues, recordIngestRun, refreshLatest, replaceMasterData, upsertPrices } from "./db";
import type { Env, MasterData, PriceRecord } from "./types";

const JOB_KEY = "ingest:job";
const MASTER_KEY = "ingest:master";
const MASTER_TTL_SECONDS = 60 * 60 * 24 * 7;
const DISTRICTS_PER_STEP = 4;
const UPSTREAM_CONCURRENCY = 4;

export interface IngestJob {
  id: string;
  priceDates: string[];
  dateIndex: number;
  districtIndex: number;
  districts: number[];
  rowsWritten: number;
  districtsOk: number;
  districtsMissing: number;
  startedAt: string;
  steps: number;
  status: "running" | "done" | "failed";
  error?: string;
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
 * Find the most recent dates that actually contain submissions.
 *
 * Returned oldest-first: carry-forward detection compares a day against the
 * day before it, so the earlier day must already be in the database.
 */
async function targetDates(env: Env, lookbackDays: number): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const ymd = d.toISOString().slice(0, 10);
    const rows = await fetchDailyPrices({ priceDate: ymd, districtId: 47 }, { baseUrl: env.SOURCE_API });
    if (rows.length > 0) {
      found.push(ymd);
      if (found.length >= 3) break; // today + yesterday + the day before
    }
  }
  return found.reverse();
}

/**
 * Hands a background promise to the runtime so it survives the response.
 * The Worker passes `ctx.waitUntil`; tests pass a collector.
 */
export type Defer = (fn: () => Promise<unknown>) => void;

/** Kick off a new ingest chain. Safe to call repeatedly. */
export async function startIngest(
  env: Env,
  baseUrl: string,
  token: string,
  defer: Defer,
  lookbackDays = 5,
): Promise<IngestJob> {
  const existing = await env.CACHE.get(JOB_KEY, "json");
  if (existing && (existing as IngestJob).status === "running") {
    // A job is already in flight; do not start a second one.
    return existing as IngestJob;
  }

  const master = await getMaster(env);
  const dates = await targetDates(env, lookbackDays);

  const job: IngestJob = {
    id: `job_${Date.now().toString(36)}`,
    priceDates: dates,
    dateIndex: 0,
    districtIndex: 0,
    districts: master.districts.map((d) => d.id),
    rowsWritten: 0,
    districtsOk: 0,
    districtsMissing: 0,
    startedAt: new Date().toISOString(),
    steps: 0,
    status: "running",
  };

  await env.CACHE.put(JOB_KEY, JSON.stringify(job), { expirationTtl: 3600 });
  await recordIngestRun(env.DB, {
    priceDate: dates[0] ?? new Date().toISOString().slice(0, 10),
    scope: "district",
    startedAt: job.startedAt,
    status: "running",
  });

  chain(env, baseUrl, token, defer);
  return job;
}

/** Process one batch and schedule the next one. */
export async function stepIngest(env: Env, baseUrl: string, token: string, defer: Defer): Promise<IngestJob> {
  const raw = await env.CACHE.get(JOB_KEY, "json");
  if (!raw) throw new Error("no ingest job in state");
  const job = raw as IngestJob;
  if (job.status !== "running") return job;
  return advance(env, baseUrl, token, defer, job);
}

async function advance(env: Env, baseUrl: string, token: string, defer: Defer, job: IngestJob): Promise<IngestJob> {
  const master = await getMaster(env);
  const current = job.priceDates[job.dateIndex];
  if (!current) {
    job.status = "done";
    await env.CACHE.put(JOB_KEY, JSON.stringify(job), { expirationTtl: 3600 });
    return job;
  }

  const startedAt = new Date().toISOString();
  const batch = job.districts.slice(job.districtIndex, job.districtIndex + DISTRICTS_PER_STEP);

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

  for (const res of results) {
    if (res.error) {
      missing++;
      continue;
    }
    if (res.rows.length === 0) {
      missing++;
      continue;
    }
    ok++;
    const prevMap = await previousValues(env.DB, res.districtId, current);
    records.push(
      ...normalizeBatch(res.rows, { priceDate: current, districtId: res.districtId, upazilaId: null }, prevMap),
    );
  }

  if (records.length > 0) {
    const written = await upsertPrices(env.DB, records);
    job.rowsWritten += written;
  }
  job.districtsOk += ok;
  job.districtsMissing += missing;
  job.districtIndex += batch.length;
  job.steps++;

  if (job.districtIndex >= job.districts.length) {
    await refreshLatest(env.DB, current);
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
    job.dateIndex++;
    job.districtIndex = 0;
  }

  if (job.dateIndex >= job.priceDates.length) {
    job.status = "done";
    await env.CACHE.put(JOB_KEY, JSON.stringify(job), { expirationTtl: 3600 });
    await backfillNational(env, job);
    return job;
  }

  await env.CACHE.put(JOB_KEY, JSON.stringify(job), { expirationTtl: 3600 });
  chain(env, baseUrl, token, defer);
  return job;
}

/** Schedule the next step of the chain without blocking the current request. */
function chain(env: Env, baseUrl: string, token: string, defer: Defer): void {
  const url = `${baseUrl.replace(/\/$/, "")}/internal/ingest/step`;
  defer(async () => {
    try {
      await fetch(url, { method: "POST", headers: { "X-Admin-Token": token } });
    } catch (err) {
      // Surface the failure in the job state so the health endpoint shows it.
      try {
        const raw = await env.CACHE.get(JOB_KEY, "json");
        if (raw) {
          const job = raw as IngestJob;
          job.error = err instanceof Error ? err.message : String(err);
          await env.CACHE.put(JOB_KEY, JSON.stringify(job), { expirationTtl: 3600 });
        }
      } catch {
        /* best effort */
      }
    }
  });
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
          rawUnitId: c.unitRetail ?? 2,
          divisor: 1,
          divisorSource: "table",
        },
        wholesale: Number.isFinite(wholesale)
          ? {
              min: Math.round((wholesale / 100) * 100) / 100,
              max: Number.isFinite(wholesaleMax) ? Math.round((wholesaleMax / 100) * 100) / 100 : null,
              avg: Math.round((wholesale / 100) * 100) / 100,
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

/** Refresh master data (weekly job). */
export async function refreshMaster(env: Env): Promise<{ districts: number; upazilas: number; commodities: number }> {
  const master = await fetchMasterData({ baseUrl: env.SOURCE_API });
  await replaceMasterData(env.DB, master);
  await env.CACHE.put(MASTER_KEY, JSON.stringify(master), { expirationTtl: MASTER_TTL_SECONDS });
  return {
    districts: master.districts.length,
    upazilas: master.upazilas.length,
    commodities: master.commodities.length,
  };
}
