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
  previousValues,
  readJob,
  recordIngestRun,
  refreshLatest,
  replaceMasterData,
  upsertPrices,
  writeJob,
} from "./db";
import type { Env, MasterData, PriceRecord } from "./types";

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

  // No job running. Decide whether one is due.
  const last = await lastCompletedReport(env.DB);  const age = last ? Date.now() - Date.parse(last) : Number.POSITIVE_INFINITY;
  if (age > REFRESH_AFTER_MS) {
    return { action: "started", job: await startIngest(env) };
  }
  return { action: "idle" };
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
      console.error(`district ${res.districtId} failed: ${res.error}`);
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
  job.updatedAt = new Date().toISOString();

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
    // Publish the daily digest to Telegram, once the date is complete.
    try {
      const { publishDigest } = await import("./telegram");
      const res = await publishDigest(env, await buildDigestInput(env, current));
      if (res.sent) console.log(`digest published for ${current}`);
      else if (res.error) console.log(`digest skipped: ${res.error}`);
    } catch (err) {
      console.error("digest failed", err);
    }
    job.dateIndex++;
    job.districtIndex = 0;
  }

  if (job.dateIndex >= job.priceDates.length) {
    job.status = "done";
    await writeJob(env.DB, job);
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

/**
 * Assemble the digest input for one report date: the rows for the headline
 * commodities, ready to be turned into a message.
 */
export async function buildDigestInput(env: Env, priceDate: string) {
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
  };
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
