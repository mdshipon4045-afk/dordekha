/**
 * D1 access layer. Every read path in the app goes through here so that the
 * hot paths stay index-friendly (D1 free tier hard-fails on row-read
 * overages rather than throttling, so an accidental table scan is an outage).
 */

import type { MasterData, PriceRecord } from "./types";

export interface DbEnv {
  DB: D1Database;
}

export interface PriceRowOut {
  priceDate: string;
  districtId: number;
  upazilaId: number;
  commodityId: number;
  groupId: number;
  subGroupId: number;
  retail: { min: number | null; max: number | null; avg: number | null; unit: number | null } | null;
  wholesale: {
    min: number | null;
    max: number | null;
    avg: number | null;
    unit: number | null;
    divisor: number | null;
    divisorSource: string | null;
  } | null;
  carriedForward: boolean;
  anomaly: string | null;
}

const SELECT_COLS = `
  price_date, district_id, upazila_id, commodity_id, group_id, sub_group_id,
  retail_min, retail_max, retail_avg, retail_unit,
  wholesale_min, wholesale_max, wholesale_avg, wholesale_unit,
  wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly
`;

function mapRow(r: Record<string, unknown>): PriceRowOut {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const hasRetail = r.retail_avg !== null && r.retail_avg !== undefined;
  const hasWholesale = r.wholesale_avg !== null && r.wholesale_avg !== undefined;
  return {
    priceDate: String(r.price_date),
    districtId: Number(r.district_id),
    upazilaId: Number(r.upazila_id),
    commodityId: Number(r.commodity_id),
    groupId: Number(r.group_id),
    subGroupId: Number(r.sub_group_id),
    retail: hasRetail
      ? { min: num(r.retail_min), max: num(r.retail_max), avg: num(r.retail_avg), unit: num(r.retail_unit) }
      : null,
    wholesale: hasWholesale
      ? {
          min: num(r.wholesale_min),
          max: num(r.wholesale_max),
          avg: num(r.wholesale_avg),
          unit: num(r.wholesale_unit),
          divisor: num(r.wholesale_divisor),
          divisorSource: (r.wholesale_divisor_src as string | null) ?? null,
        }
      : null,
    carriedForward: Number(r.carried_forward) === 1,
    anomaly: (r.anomaly as string | null) ?? null,
  };
}

/**
 * Bulk upsert a batch of normalised records.
 *
 * D1 rejects a statement with too many bound parameters ("too many SQL
 * variables"), so rows are grouped into small statements and those
 * statements are sent together with `db.batch()` — one round trip per
 * group, each statement staying well inside the parameter limit.
 */
export async function upsertPrices(db: D1Database, records: PriceRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  const COLUMNS = 19;
  /** Conservative: D1 starts rejecting somewhere around 100 bound values. */
  const MAX_VARS_PER_STATEMENT = 90;
  const ROWS_PER_STATEMENT = Math.max(1, Math.floor(MAX_VARS_PER_STATEMENT / COLUMNS));
  const STATEMENTS_PER_BATCH = 25;

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  for (let i = 0; i < records.length; i += ROWS_PER_STATEMENT) {
    const chunk = records.slice(i, i + ROWS_PER_STATEMENT);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (const r of chunk) {
      placeholders.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      values.push(
        r.priceDate,
        r.districtId,
        r.upazilaId ?? 0,
        r.commodityId,
        r.commodityGroupId,
        r.commoditySubGroupId,
        r.retail?.min ?? null,
        r.retail?.max ?? null,
        r.retail?.avg ?? null,
        r.retail?.rawUnitId ?? null,
        r.wholesale?.min ?? null,
        r.wholesale?.max ?? null,
        r.wholesale?.avg ?? null,
        r.wholesale?.rawUnitId ?? null,
        r.wholesale?.divisor ?? null,
        r.wholesale?.divisorSource ?? null,
        r.carriedForward ? 1 : 0,
        r.anomaly,
        now,
      );
    }
    const sql = `
      INSERT INTO price_daily (
        price_date, district_id, upazila_id, commodity_id, group_id, sub_group_id,
        retail_min, retail_max, retail_avg, retail_unit,
        wholesale_min, wholesale_max, wholesale_avg, wholesale_unit,
        wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly, ingested_at
      ) VALUES ${placeholders.join(",")}
      ON CONFLICT(price_date, district_id, upazila_id, commodity_id) DO UPDATE SET
        group_id=excluded.group_id, sub_group_id=excluded.sub_group_id,
        retail_min=excluded.retail_min, retail_max=excluded.retail_max, retail_avg=excluded.retail_avg,
        retail_unit=excluded.retail_unit,
        wholesale_min=excluded.wholesale_min, wholesale_max=excluded.wholesale_max, wholesale_avg=excluded.wholesale_avg,
        wholesale_unit=excluded.wholesale_unit,
        wholesale_divisor=excluded.wholesale_divisor, wholesale_divisor_src=excluded.wholesale_divisor_src,
        carried_forward=excluded.carried_forward, anomaly=excluded.anomaly, ingested_at=excluded.ingested_at
    `;
    statements.push(db.prepare(sql).bind(...values));
  }

  let written = 0;
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const results = await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH));
    for (const r of results) written += r.meta?.changes ?? 0;
  }
  return written;
}

/** Refresh the materialised "latest" table from the most recent report date. */
export async function refreshLatest(db: D1Database, priceDate: string): Promise<number> {
  await db.prepare(
    `DELETE FROM price_latest
      WHERE (district_id, upazila_id, commodity_id) IN (
        SELECT district_id, upazila_id, commodity_id FROM price_daily WHERE price_date = ?)`,
  )
    .bind(priceDate)
    .run();

  const res = await db
    .prepare(
      `INSERT INTO price_latest (
         district_id, upazila_id, commodity_id, group_id, sub_group_id, price_date,
         retail_min, retail_max, retail_avg, retail_unit,
         wholesale_min, wholesale_max, wholesale_avg, wholesale_unit,
         wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly, updated_at
       )
       SELECT district_id, upazila_id, commodity_id, group_id, sub_group_id, price_date,
         retail_min, retail_max, retail_avg, retail_unit,
         wholesale_min, wholesale_max, wholesale_avg, wholesale_unit,
         wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly, ?
       FROM price_daily WHERE price_date = ?`,
    )
    .bind(new Date().toISOString(), priceDate)
    .run();

  return res.meta?.changes ?? 0;
}

/**
 * How many published price rows each commodity has.
 *
 * Used to break ties when a name is ambiguous: "চাল" matches 27 varieties,
 * but only some of them have a figure in the latest report. Picking the one
 * that actually has data is the only useful answer.
 */
export async function commodityCoverage(db: D1Database, ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT commodity_id, COUNT(*) AS c FROM price_latest
        WHERE commodity_id IN (${placeholders}) GROUP BY commodity_id`,
    )
    .bind(...ids)
    .all();
  for (const r of results ?? []) {
    const row = r as Record<string, unknown>;
    map.set(Number(row.commodity_id), Number(row.c ?? 0));
  }
  return map;
}

/** The most recent report date that actually has rows. */
export async function latestDate(db: D1Database): Promise<string | null> {
  const row = await db.prepare(`SELECT MAX(price_date) AS d FROM price_daily`).first<{ d: string | null }>();
  return row?.d ?? null;
}

/** Latest snapshot for one district (upazila_id = 0). */
export async function latestForDistrict(
  db: D1Database,
  districtId: number,
  limit = 500,
): Promise<PriceRowOut[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS.replace(/price_date/g, "price_date")} FROM price_latest
        WHERE district_id = ? AND upazila_id = 0
        ORDER BY group_id, commodity_id LIMIT ?`,
    )
    .bind(districtId, limit)
    .all();
  return (results ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Latest snapshot for one commodity across all districts. */
export async function latestForCommodity(
  db: D1Database,
  commodityId: number,
  limit = 200,
): Promise<PriceRowOut[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS} FROM price_latest
        WHERE commodity_id = ? AND upazila_id = 0
        ORDER BY district_id LIMIT ?`,
    )
    .bind(commodityId, limit)
    .all();
  return (results ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** History for one commodity in one district, oldest → newest. */
export async function historyFor(
  db: D1Database,
  commodityId: number,
  districtId: number,
  sinceDate: string,
  limit = 400,
): Promise<PriceRowOut[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS} FROM price_daily
        WHERE commodity_id = ? AND district_id = ? AND upazila_id = 0 AND price_date >= ?
        ORDER BY price_date DESC LIMIT ?`,
    )
    .bind(commodityId, districtId, sinceDate, limit)
    .all();
  return (results ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Previous reported values for a district, used for carry-forward detection. */
export async function previousValues(
  db: D1Database,
  districtId: number,
  beforeDate: string,
): Promise<Map<number, { retailAvg: number | null; wholesaleAvg: number | null }>> {
  const { results } = await db
    .prepare(
      `SELECT commodity_id, retail_avg, wholesale_avg FROM price_daily
        WHERE district_id = ? AND upazila_id = 0 AND price_date = (
          SELECT MAX(price_date) FROM price_daily
            WHERE district_id = ? AND upazila_id = 0 AND price_date < ?
        )`,
    )
    .bind(districtId, districtId, beforeDate)
    .all();
  const map = new Map<number, { retailAvg: number | null; wholesaleAvg: number | null }>();
  for (const r of results ?? []) {
    map.set(Number((r as Record<string, unknown>).commodity_id), {
      retailAvg: (r as Record<string, unknown>).retail_avg as number | null,
      wholesaleAvg: (r as Record<string, unknown>).wholesale_avg as number | null,
    });
  }
  return map;
}

/** Replace master data atomically enough for our purposes. */
export async function replaceMasterData(db: D1Database, master: MasterData): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`DELETE FROM district`),
    db.prepare(`DELETE FROM upazila`),
    db.prepare(`DELETE FROM commodity`),
    db.prepare(`DELETE FROM commodity_group`),
    db.prepare(`DELETE FROM unit`),
  ]);

  const chunks: D1PreparedStatement[] = [];
  for (const d of master.districts) {
    chunks.push(
      db.prepare(`INSERT OR REPLACE INTO district (id,name_bn,name_en,division_id) VALUES (?,?,?,?)`).bind(
        d.id,
        d.nameBn,
        d.nameEn,
        d.divisionId,
      ),
    );
  }
  for (const u of master.upazilas) {
    chunks.push(
      db.prepare(`INSERT OR REPLACE INTO upazila (id,name_bn,name_en,district_id,division_id) VALUES (?,?,?,?,?)`).bind(
        u.id,
        u.nameBn,
        u.nameEn,
        u.districtId,
        u.divisionId,
      ),
    );
  }
  for (const c of master.commodities) {
    chunks.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO commodity (id,name_bn,name_en,group_id,sub_group_id,unit_retail,unit_wholesale) VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(c.id, c.nameBn, c.nameEn, c.groupId, c.subGroupId, c.unitRetail, c.unitWholesale),
    );
  }
  for (const g of master.groups) {
    chunks.push(
      db.prepare(`INSERT OR REPLACE INTO commodity_group (id,name_bn,name_en) VALUES (?,?,?)`).bind(g.id, g.nameBn, g.nameEn),
    );
  }
  for (const [id, u] of Object.entries(master.units)) {
    chunks.push(
      db.prepare(`INSERT OR REPLACE INTO unit (id,name_bn,name_en) VALUES (?,?,?)`).bind(Number(id), u.bn, u.en),
    );
  }

  for (let i = 0; i < chunks.length; i += 100) {
    await db.batch(chunks.slice(i, i + 100));
  }
  void now;
}

const JOB_ROW_ID = 1;

/**
 * Read the ingest job state.
 *
 * D1, not KV: the chain hands off between requests and KV's eventual
 * consistency would let the next step read a stale job and kill the chain.
 */
export async function readJob<T>(db: D1Database): Promise<T | null> {
  const row = await db.prepare(`SELECT job_json FROM ingest_job WHERE id = ?`).bind(JOB_ROW_ID).first<{ job_json: string }>();
  if (!row?.job_json) return null;
  try {
    return JSON.parse(row.job_json) as T;
  } catch {
    return null;
  }
}

/** Write the ingest job state. */
export async function writeJob(db: D1Database, job: unknown): Promise<void> {
  const json = JSON.stringify(job);
  await db
    .prepare(
      `INSERT INTO ingest_job (id, job_json, updated_at) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET job_json=excluded.job_json, updated_at=excluded.updated_at`,
    )
    .bind(JOB_ROW_ID, json, new Date().toISOString())
    .run();
}

export async function recordIngestRun(
  db: D1Database,
  run: {
    priceDate: string;
    scope: string;
    startedAt: string;
    finishedAt?: string;
    rowsWritten?: number;
    districtsOk?: number;
    districtsMissing?: number;
    status: string;
    error?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ingest_run (price_date, scope, started_at, finished_at, rows_written, districts_ok, districts_missing, status, error)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      run.priceDate,
      run.scope,
      run.startedAt,
      run.finishedAt ?? null,
      run.rowsWritten ?? 0,
      run.districtsOk ?? 0,
      run.districtsMissing ?? 0,
      run.status,
      run.error ?? null,
    )
    .run();
}

/** Health assertion used by the monitoring heartbeat. */
export async function ingestHealth(
  db: D1Database,
): Promise<{ latestDate: string | null; lastRun: Record<string, unknown> | null; rowsToday: number }> {
  const d = await latestDate(db);
  const last = await db
    .prepare(`SELECT price_date, scope, finished_at, rows_written, status, error FROM ingest_run ORDER BY id DESC LIMIT 1`)
    .first<Record<string, unknown>>();
  const rows = d
    ? (
        await db.prepare(`SELECT COUNT(*) AS c FROM price_daily WHERE price_date = ?`).bind(d).first<{ c: number }>()
      )?.c ?? 0
    : 0;
  return { latestDate: d, lastRun: last ?? null, rowsToday: rows };
}
