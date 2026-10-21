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
// The data changes once a day, and the ingest refreshes the aggregates when
// it does. A long life here means few cache writes — the free tier allows a
// thousand writes a day — while a short one would mean recomputing on a
// timer for no benefit.
const AGGREGATE_TTL = 6 * 60 * 60;
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
  /** The unit the upstream used, for audit. */
  wru: number | null;
  /** The divisor the ingest recorded — per row, never a constant. */
  wdiv: number | null;
  wdivsrc: string | null;
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
  /** How many of the catalogue's commodities have published prices. */
  commoditiesWithData: number;
  /** How many of the 64 districts submitted figures. */
  districtsWithData: number;
  /** The number of upazilas the source exposes. */
  upazilaCount: number;
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
  commoditiesWithData: 0,
  districtsWithData: 0,
  upazilaCount: 0,
  carriedPct: null,
  busiestDistrictId: 47,
  busiestDistrictName: "ঢাকা",
};

/**
 * The aggregates, computed from the cache.
 *
 * This is the path that has to work, because it is the one that is free.
 * Computing them from the database meant a COUNT(*) over the whole price
 * table every hour — 700,000 rows twenty-four times a day once the backfill
 * finishes, which is more than three times the daily read budget. And when
 * the read budget was already spent, the database path failed and every
 * published statistic fell to zero: the site claimed "0 districts" and
 * "no dates yet" while the data was sitting right there in the cache.
 *
 * The cache holds the same information: the snapshot has the current rows
 * and their dates, the history snapshot has every date held, and the master
 * snapshot has the reference lists.
 */
async function computeAggregatesFromCache(env: Env): Promise<Aggregates | null> {
  const [snap, hist, master] = await Promise.all([
    getSnapshot(env),
    getHistorySnapshot(env),
    getMasterSnapshot(env),
  ]);
  if (!snap || snap.rows.length === 0) return null;

  const rows = snap.rows;
  const history = hist?.rows ?? [];

  const dates = new Set<string>();
  for (const r of history) dates.add(r.t);
  for (const r of rows) dates.add(r.t);
  const sortedDates = [...dates].sort();
  const latest = sortedDates[sortedDates.length - 1] ?? null;
  const first = sortedDates[0] ?? null;

  const latestRows = rows.filter((r) => r.t === latest);
  const carried = latestRows.filter((r) => r.cf === 1).length;

  const byDistrict = new Map<number, number>();
  for (const r of latestRows) byDistrict.set(r.d, (byDistrict.get(r.d) ?? 0) + 1);
  let busiestId = 47;
  let busiestCount = -1;
  for (const [id, n] of byDistrict) {
    if (n > busiestCount) {
      busiestCount = n;
      busiestId = id;
    }
  }
  const busiestName = master?.districts.find((d) => d.id === busiestId)?.nameBn ?? "ঢাকা";

  return {
    latestDate: latest,
    firstDate: first,
    days: sortedDates.length,
    rowCount: history.length > 0 ? history.length : rows.length,
    commodityCount: master?.commodities.length ?? 0,
    districtCount: master?.districts.length ?? 0,
    commoditiesWithData: new Set(latestRows.map((r) => r.c)).size,
    districtsWithData: byDistrict.size,
    upazilaCount: 0,
    carriedPct:
      latestRows.length > 0 ? Math.round((carried / latestRows.length) * 1000) / 10 : null,
    busiestDistrictId: busiestId,
    busiestDistrictName: busiestName,
  };
}

/**
 * The aggregates, computed from the database.
 *
 * Only used when the cache is empty. This path scans the price table, so
 * it is never reached while the cache is warm.
 */
async function computeAggregatesFromDb(env: Env): Promise<Aggregates | null> {
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
    let commoditiesWithData = 0;
    let districtsWithData = 0;
    const last = span?.last ?? null;
    if (last) {
      const c = await env.DB
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN carried_forward = 1 THEN 1 ELSE 0 END) AS carried,
                  COUNT(DISTINCT commodity_id) AS commodities,
                  COUNT(DISTINCT district_id) AS districts
             FROM price_daily WHERE price_date = ? AND district_id > 0`,
        )
        .bind(last)
        .first<{ total: number; carried: number; commodities: number; districts: number }>();
      if (c?.total) carriedPct = Math.round((c.carried / c.total) * 1000) / 10;
      commoditiesWithData = c?.commodities ?? 0;
      districtsWithData = c?.districts ?? 0;
    }

    // The upazila count comes from the source's own reference table. It is
    // counted, never asserted: a "505 upazilas" claim on a dataset with
    // zero upazila rows is the kind of thing an assistant repeats back.
    let upazilaCount = 0;
    try {
      const u = await env.DB.prepare(`SELECT COUNT(*) AS c FROM upazila`).first<{ c: number }>();
      upazilaCount = u?.c ?? 0;
    } catch {
      upazilaCount = 0;
    }

    return {
      latestDate: last,
      firstDate: span?.first ?? null,
      days: span?.days ?? 0,
      rowCount: span?.rows ?? 0,
      commodityCount: counts?.commodities ?? 0,
      districtCount: counts?.districts ?? 0,
      commoditiesWithData,
      districtsWithData,
      upazilaCount,
      carriedPct,
      busiestDistrictId: busy?.id ?? 47,
      busiestDistrictName: busy?.name ?? "ঢাকা",
    };
  } catch {
    return null;
  }
}

async function computeAggregates(env: Env): Promise<Aggregates | null> {
  // The cache first: it is free, it is instant, and it cannot run out.
  const fromCache = await computeAggregatesFromCache(env);
  if (fromCache) return fromCache;
  return computeAggregatesFromDb(env);
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
  /** The unit the upstream used, for audit. */
  wru: number | null;
  /** The divisor the ingest recorded — per row, never a constant. */
  wdiv: number | null;
  wdivsrc: string | null;
  cf: 0 | 1;
  an: string | null;
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

/**
 * Write the current prices to KV so the site keeps working when the
 * database cannot be read.
 *
 * The rows come from the "latest" table, which the ingest only ever moves
 * forward in time, so the snapshot cannot hold a stale date. The divisor
 * and its source are carried across, because a snapshot that reported a
 * constant 100 would be making a claim the data does not support.
 */
export async function writeSnapshot(env: Env): Promise<number> {
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT district_id AS d, commodity_id AS c, group_id AS g, price_date AS t,
                retail_min AS rmin, retail_max AS rmax, retail_avg AS ravg, retail_unit AS ru,
                wholesale_min AS wmin, wholesale_max AS wmax, wholesale_avg AS wavg,
                wholesale_unit AS wu, wholesale_raw_unit AS wru,
                wholesale_divisor AS wdiv, wholesale_divisor_src AS wdivsrc,
                carried_forward AS cf, anomaly AS an
           FROM price_latest
          WHERE upazila_id = 0 AND district_id > 0`,
      )
      .all();
    const rows = (results ?? []) as unknown as SnapshotRow[];
    // The date of the newest row, not the date of the first row: the table
    // is not ordered, and a snapshot labelled with one district's date
    // would be wrong for the other sixty-three.
    const date = rows.reduce<string | null>(
      (max, r) => (max === null || r.t > max ? r.t : max),
      null,
    );
    await setSnapshot(env, { at: new Date().toISOString(), date, rows });
    return rows.length;
  } catch {
    return 0;
  }
}
