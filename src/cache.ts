/**
 * Caching and resilience.
 *
 * Two problems this solves.
 *
 * 1. D1's free tier allows 5,000,000 rows read per day. Some of the
 *    aggregates this site needs (the latest date, the row counts, how far
 *    back the history reaches) change at most once a day, but were being
 *    recomputed on every request. They are cached in KV now.
 *
 * 2. When the read budget is exhausted, D1 starts returning errors and
 *    every page fails. A price service that answers "500" is worse than
 *    useless — it looks like the data is gone. So the current prices are
 *    also kept as a compact snapshot in KV, and the read paths fall back to
 *    it. The site degrades to slightly stale data instead of to nothing.
 */

import type { Env } from "./types";

const SNAPSHOT_KEY = "snapshot:latest";
const AGGREGATE_TTL = 60 * 60; // an hour is plenty for daily aggregates
const SNAPSHOT_TTL = 60 * 60 * 24 * 2;

export interface SnapshotRow {
  d: number; // district id
  c: number; // commodity id
  g: number; // group id
  t: string; // price date
  rmin: number | null;
  rmax: number | null;
  ravg: number | null;
  ru: number | null;
  wmin: number | null;
  wmax: number | null;
  wavg: number | null;
  wu: number | null;
  cf: 0 | 1;
  an: string | null;
}

export interface Snapshot {
  at: string;
  date: string | null;
  rows: SnapshotRow[];
}

/** Cached daily aggregates. */
export interface Aggregates {
  latestDate: string | null;
  firstDate: string | null;
  days: number;
  rowCount: number;
  commodityCount: number;
  districtCount: number;
  carriedPct: number | null;
  busiestDistrictId: number;
  busiestDistrictName: string;
}

const AGGREGATE_KEY = "agg:current";

/** Read a value from KV, returning null on any failure. */
async function kvGet<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.CACHE.get(key, "json");
    return (raw as T) ?? null;
  } catch {
    return null;
  }
}

async function kvSet(env: Env, key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    /* a cache write failure must never break a request */
  }
}

/**
 * The aggregates, computed once and then served from the cache.
 *
 * The computation is wrapped so that a D1 failure returns the previously
 * cached copy rather than an error.
 */
export async function getAggregates(env: Env): Promise<Aggregates> {
  const cached = await kvGet<Aggregates>(env, AGGREGATE_KEY);
  if (cached) return cached;

  const computed = await computeAggregates(env);
  if (computed) await kvSet(env, AGGREGATE_KEY, computed, AGGREGATE_TTL);
  return computed ?? cached ?? EMPTY_AGGREGATES;
}

const EMPTY_AGGREGATES: Aggregates = {
  latestDate: null,
  firstDate: null,
  days: 0,
  rowCount: 0,
  commodityCount: 0,
  districtCount: 0,
  carriedPct: null,
  busiestDistrictId: 47,
  busiestDistrictName: "ঢাকা",
};

async function computeAggregates(env: Env): Promise<Aggregates | null> {
  try {
    const [span, counts, busy] = await Promise.all([
      env.DB
        .prepare(
          `SELECT MIN(price_date) AS first, MAX(price_date) AS last, COUNT(DISTINCT price_date) AS days,
                  COUNT(*) AS rows FROM price_daily WHERE district_id > 0`,
        )
        .first<{ first: string | null; last: string | null; days: number; rows: number }>(),
      env.DB
        .prepare(
          `SELECT (SELECT COUNT(*) FROM commodity) AS commodities, (SELECT COUNT(*) FROM district WHERE id > 0) AS districts`,
        )
        .first<{ commodities: number; districts: number }>(),
      env.DB
        .prepare(
          `SELECT d.id AS id, d.name_bn AS name, COUNT(*) AS n FROM price_latest p
             JOIN district d ON d.id = p.district_id
            WHERE p.upazila_id = 0 AND p.district_id > 0 AND p.retail_avg IS NOT NULL
            GROUP BY d.id ORDER BY n DESC LIMIT 1`,
        )
        .first<{ id: number; name: string }>(),
    ]);

    let carriedPct: number | null = null;
    const last = span?.last ?? null;
    if (last) {
      const c = await env.DB
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN carried_forward = 1 THEN 1 ELSE 0 END) AS carried
             FROM price_daily WHERE price_date = ?`,
        )
        .bind(last)
        .first<{ total: number; carried: number }>();
      if (c?.total) carriedPct = Math.round((c.carried / c.total) * 1000) / 10;
    }

    return {
      latestDate: last,
      firstDate: span?.first ?? null,
      days: span?.days ?? 0,
      rowCount: span?.rows ?? 0,
      commodityCount: counts?.commodities ?? 0,
      districtCount: counts?.districts ?? 0,
      carriedPct,
      busiestDistrictId: busy?.id ?? 47,
      busiestDistrictName: busy?.name ?? "ঢাকা",
    };
  } catch {
    return null;
  }
}

/** Refresh the cached aggregates. Called after an ingest. */
export async function refreshAggregates(env: Env): Promise<void> {
  const computed = await computeAggregates(env);
  if (computed) await kvSet(env, AGGREGATE_KEY, computed, AGGREGATE_TTL);
}

/* ── Snapshot ───────────────────────────────────────────────────────────── */

export async function getSnapshot(env: Env): Promise<Snapshot | null> {
  return kvGet<Snapshot>(env, SNAPSHOT_KEY);
}

export async function setSnapshot(env: Env, snap: Snapshot): Promise<void> {
  await kvSet(env, SNAPSHOT_KEY, snap, SNAPSHOT_TTL);
}

/* ── Master data and history ───────────────────────────────────────────── */

export interface CommodityRef {
  id: number;
  nameBn: string;
  nameEn: string;
  groupId: number;
  groupBn: string;
  unitRetail: number | null;
  unitWholesale: number | null;
}

export interface DistrictRef {
  id: number;
  nameBn: string;
  nameEn: string;
}

export interface UnitRef {
  id: number;
  nameBn: string;
  nameEn: string;
}

/**
 * The reference data, in one cache entry.
 *
 * The commodity, district and unit lists are small and change rarely, but
 * they were being read from the database on nearly every request. With the
 * daily read budget exhausted they were the difference between a working
 * page and a 500.
 */
export interface MasterSnapshot {
  at: string;
  commodities: CommodityRef[];
  districts: DistrictRef[];
  units: UnitRef[];
}

const MASTER_KEY = "master:snapshot";
const HISTORY_KEY = "history:snapshot";

export async function getMasterSnapshot(env: Env): Promise<MasterSnapshot | null> {
  return kvGet<MasterSnapshot>(env, MASTER_KEY);
}

export async function setMasterSnapshot(env: Env, m: MasterSnapshot): Promise<void> {
  await kvSet(env, MASTER_KEY, m, SNAPSHOT_TTL);
}

/** A row of the price history, in the compact snapshot form. */
export interface HistoryRow {
  t: string; // price date
  d: number; // district id
  c: number; // commodity id
  rmin: number | null;
  rmax: number | null;
  ravg: number | null;
  ru: number | null;
  wmin: number | null;
  wmax: number | null;
  wavg: number | null;
  wu: number | null;
  cf: 0 | 1;
}

export async function getHistorySnapshot(env: Env): Promise<{ rows: HistoryRow[] } | null> {
  return kvGet<{ rows: HistoryRow[] }>(env, HISTORY_KEY);
}

export async function setHistorySnapshot(env: Env, rows: HistoryRow[]): Promise<void> {
  await kvSet(env, HISTORY_KEY, { rows }, SNAPSHOT_TTL);
}

/** Write a set of aggregates into the cache (used by the upload path). */
export async function setAggregates(env: Env, agg: Aggregates): Promise<void> {
  await kvSet(env, AGGREGATE_KEY, agg, AGGREGATE_TTL);
}

/** Write the current prices to KV so the site keeps working when the
 * database cannot be read. */
export async function writeSnapshot(env: Env): Promise<number> {
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT district_id AS d, commodity_id AS c, group_id AS g, price_date AS t,
                retail_min AS rmin, retail_max AS rmax, retail_avg AS ravg, retail_unit AS ru,
                wholesale_min AS wmin, wholesale_max AS wmax, wholesale_avg AS wavg,
                wholesale_unit AS wu, carried_forward AS cf, anomaly AS an
           FROM price_latest
          WHERE upazila_id = 0 AND district_id > 0`,
      )
      .all();
    const rows = (results ?? []) as unknown as SnapshotRow[];
    const date = rows.length ? rows[0]?.t ?? null : null;
    await setSnapshot(env, { at: new Date().toISOString(), date, rows });
    return rows.length;
  } catch {
    return 0;
  }
}
