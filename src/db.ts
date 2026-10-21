/**
 * D1 access layer. Every read path in the app goes through here so that the
 * hot paths stay index-friendly (D1 free tier hard-fails on row-read
 * overages rather than throttling, so an accidental table scan is an outage).
 */

import type { MasterData, PriceRecord } from "./types";
import { commoditySlug, districtSlug } from "./slug";

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
    /** The unit the value is in (the retail unit). */
    unit: number | null;
    /** The unit the upstream used, for audit. */
    rawUnit: number | null;
    divisor: number | null;
    divisorSource: string | null;
  } | null;
  carriedForward: boolean;
  anomaly: string | null;
}

const SELECT_COLS = `
  price_date, district_id, upazila_id, commodity_id, group_id, sub_group_id,
  retail_min, retail_max, retail_avg, retail_unit,
  wholesale_min, wholesale_max, wholesale_avg, wholesale_unit, wholesale_raw_unit,
  wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly
`;

function mapRow(r: Record<string, unknown>): PriceRowOut {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const hasRetail = r.retail_avg !== null && r.retail_avg !== undefined;
  const hasWholesale = r.wholesale_avg !== null && r.wholesale_avg !== undefined;
  const retailUnit = num(r.retail_unit);
  return {
    priceDate: String(r.price_date),
    districtId: Number(r.district_id),
    upazilaId: Number(r.upazila_id),
    commodityId: Number(r.commodity_id),
    groupId: Number(r.group_id),
    subGroupId: Number(r.sub_group_id),
    retail: hasRetail
      ? { min: num(r.retail_min), max: num(r.retail_max), avg: num(r.retail_avg), unit: retailUnit }
      : null,
    wholesale: hasWholesale
      ? {
          min: num(r.wholesale_min),
          max: num(r.wholesale_max),
          avg: num(r.wholesale_avg),
          // The value is in the retail unit; the upstream's own unit is kept
          // only for audit.
          unit: retailUnit,
          rawUnit: num(r.wholesale_raw_unit) ?? num(r.wholesale_unit),
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

  const COLUMNS = 20;
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
      placeholders.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
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
        r.retail?.unitId ?? null,
        r.wholesale?.min ?? null,
        r.wholesale?.max ?? null,
        r.wholesale?.avg ?? null,
        r.wholesale?.unitId ?? null,
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
        wholesale_min, wholesale_max, wholesale_avg, wholesale_unit, wholesale_raw_unit,
        wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly, ingested_at
      ) VALUES ${placeholders.join(",")}
      ON CONFLICT(price_date, district_id, upazila_id, commodity_id) DO UPDATE SET
        group_id=excluded.group_id, sub_group_id=excluded.sub_group_id,
        retail_min=excluded.retail_min, retail_max=excluded.retail_max, retail_avg=excluded.retail_avg,
        retail_unit=excluded.retail_unit,
        wholesale_min=excluded.wholesale_min, wholesale_max=excluded.wholesale_max, wholesale_avg=excluded.wholesale_avg,
        wholesale_unit=excluded.wholesale_unit, wholesale_raw_unit=excluded.wholesale_raw_unit,
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

/**
 * Refresh the materialised "latest" table for one batch.
 *
 * Only the rows just written are touched. Re-copying a whole date every
 * time was writing 3,900 rows per call, and with a few hundred calls that
 * is the entire daily write budget of the free tier spent on a table that
 * only ever holds one date per key.
 */
export async function refreshLatestFor(
  db: D1Database,
  priceDate: string,
  districtIds: number[],
): Promise<number> {
  if (districtIds.length === 0) return 0;
  const placeholders = districtIds.map(() => "?").join(",");
  const res = await db
    .prepare(
      `INSERT INTO price_latest (
         district_id, upazila_id, commodity_id, group_id, sub_group_id, price_date,
         retail_min, retail_max, retail_avg, retail_unit,
         wholesale_min, wholesale_max, wholesale_avg, wholesale_unit, wholesale_raw_unit,
         wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly, updated_at
       )
       SELECT district_id, upazila_id, commodity_id, group_id, sub_group_id, price_date,
         retail_min, retail_max, retail_avg, retail_unit,
         wholesale_min, wholesale_max, wholesale_avg, wholesale_unit, wholesale_raw_unit,
         wholesale_divisor, wholesale_divisor_src, carried_forward, anomaly, ?
       FROM price_daily
       WHERE price_date = ? AND district_id IN (${placeholders}) AND true
       ON CONFLICT(district_id, upazila_id, commodity_id) DO UPDATE SET
         group_id=excluded.group_id, sub_group_id=excluded.sub_group_id,
         price_date=excluded.price_date,
         retail_min=excluded.retail_min, retail_max=excluded.retail_max, retail_avg=excluded.retail_avg,
         retail_unit=excluded.retail_unit,
         wholesale_min=excluded.wholesale_min, wholesale_max=excluded.wholesale_max, wholesale_avg=excluded.wholesale_avg,
         wholesale_unit=excluded.wholesale_unit, wholesale_raw_unit=excluded.wholesale_raw_unit,
         wholesale_divisor=excluded.wholesale_divisor, wholesale_divisor_src=excluded.wholesale_divisor_src,
         carried_forward=excluded.carried_forward, anomaly=excluded.anomaly, updated_at=excluded.updated_at`,
    )
    .bind(new Date().toISOString(), priceDate, ...districtIds)
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
        WHERE commodity_id IN (${placeholders}) AND retail_avg IS NOT NULL
        GROUP BY commodity_id`,
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
        WHERE commodity_id = ? AND upazila_id = 0 AND district_id > 0
        ORDER BY district_id LIMIT ?`,
    )
    .bind(commodityId, limit)
    .all();
  return (results ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/**
 * One price on one specific date.
 *
 * The date is looked up in the history, never inferred. If the source has
 * nothing for that day, the answer is that there is nothing — a request for
 * a past date must never come back carrying a newer date's figures.
 */
export async function priceForDate(
  db: D1Database,
  commodityId: number,
  districtId: number,
  date: string,
): Promise<PriceRowOut | null> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS} FROM price_daily
        WHERE commodity_id = ? AND district_id = ? AND upazila_id = 0 AND price_date = ?`,
    )
    .bind(commodityId, districtId, date)
    .all();
  const row = (results ?? [])[0];
  return row ? mapRow(row as Record<string, unknown>) : null;
}

/** The actual span of history we hold. */
export async function historyRange(db: D1Database): Promise<{ first: string | null; last: string | null; days: number }> {
  const row = await db
    .prepare(
      `SELECT MIN(price_date) AS first, MAX(price_date) AS last, COUNT(DISTINCT price_date) AS days
         FROM price_daily WHERE district_id > 0`,
    )
    .first<{ first: string | null; last: string | null; days: number }>();
  return { first: row?.first ?? null, last: row?.last ?? null, days: row?.days ?? 0 };
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

/* ── Home page data ──────────────────────────────────────────────────────── */

export interface LedgerRowDb {
  commodityId: number;
  districtId: number;
  commodityBn: string;
  commodityEn: string;
  commoditySlug: string;
  districtBn: string;
  districtEn: string;
  districtSlug: string;
  retail: { min: number | null; max: number | null; avg: number | null; unitBn: string } | null;
  wholesale: { min: number | null; max: number | null; avg: number | null } | null;
  carriedForward: boolean;
  date: string;
}

export interface MoverRowDb {
  commodityBn: string;
  districtBn: string;
  now: number | null;
  was: number | null;
  changePct: number | null;
}

/** The ledger rows for the home page: the most recent report, in one district. */
export async function ledgerRows(db: D1Database, districtId: number, limit = 14): Promise<LedgerRowDb[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS cid, c.name_bn AS cbn, c.name_en AS cen, d.id AS did, d.name_bn AS dbn, d.name_en AS den,
              p.retail_min, p.retail_max, p.retail_avg, p.wholesale_min, p.wholesale_max, p.wholesale_avg,
              p.carried_forward, p.price_date, u.name_bn AS unit
         FROM price_latest p
         JOIN commodity c ON c.id = p.commodity_id
         JOIN district d ON d.id = p.district_id
         LEFT JOIN unit u ON u.id = p.retail_unit
        WHERE p.district_id = ? AND p.upazila_id = 0
        ORDER BY p.group_id, c.name_bn
        LIMIT ?`,
    )
    .bind(districtId, limit)
    .all();

  return (results ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const cid = Number(row.cid);
    const did = Number(row.did);
    return {
      commodityId: cid,
      districtId: did,
      commodityBn: String(row.cbn ?? ""),
      commodityEn: String(row.cen ?? ""),
      commoditySlug: commoditySlug(String(row.cbn ?? ""), String(row.cen ?? ""), cid),
      districtBn: String(row.dbn ?? ""),
      districtEn: String(row.den ?? ""),
      districtSlug: districtSlug(String(row.dbn ?? ""), String(row.den ?? ""), did),
      retail: {
        min: num(row.retail_min),
        max: num(row.retail_max),
        avg: num(row.retail_avg),
        unitBn: String(row.unit ?? "কেজি"),
      },
      wholesale: {
        min: num(row.wholesale_min),
        max: num(row.wholesale_max),
        avg: num(row.wholesale_avg),
      },
      carriedForward: Number(row.carried_forward) === 1,
      date: String(row.price_date ?? ""),
    };
  });
}

/**
 * The biggest genuine moves between the two most recent report dates.
 *
 * Only rows that were freshly reported on the later date count — a value the
 * upstream merely copied forward did not move. Rows the upstream itself
 * flagged as anomalous are excluded, and so is any overnight change larger
 * than 100%, which is a data-entry error far more often than it is a market.
 */
export async function movers(db: D1Database, limit = 6): Promise<MoverRowDb[]> {
  const dates = await db
    .prepare(`SELECT DISTINCT price_date FROM price_daily WHERE district_id > 0 ORDER BY price_date DESC LIMIT 2`)
    .all<{ price_date: string }>();
  const list = (dates.results ?? []).map((d) => d.price_date);
  if (list.length < 2) return [];
  const [newer, older] = list as [string, string];

  const { results } = await db
    .prepare(
      `SELECT c.name_bn AS cbn, d.name_bn AS dbn,
              n.retail_avg AS now, o.retail_avg AS was
         FROM price_daily n
         JOIN price_daily o
           ON o.commodity_id = n.commodity_id
          AND o.district_id = n.district_id
          AND o.upazila_id = n.upazila_id
          AND o.price_date = ?
         JOIN commodity c ON c.id = n.commodity_id
         JOIN district d ON d.id = n.district_id
        WHERE n.price_date = ? AND n.upazila_id = 0 AND n.carried_forward = 0
          AND n.retail_avg IS NOT NULL AND o.retail_avg IS NOT NULL
          AND n.anomaly IS NULL AND o.anomaly IS NULL
          AND n.retail_avg <> o.retail_avg
          AND ABS(n.retail_avg - o.retail_avg) / n.retail_avg <= 1.0
        ORDER BY ABS(n.retail_avg - o.retail_avg) / n.retail_avg DESC
        LIMIT ?`,
    )
    .bind(older, newer, limit)
    .all();

  return (results ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const now = Number(row.now);
    const was = Number(row.was);
    return {
      commodityBn: String(row.cbn ?? ""),
      districtBn: String(row.dbn ?? ""),
      now,
      was,
      changePct: was > 0 ? ((now - was) / was) * 100 : null,
    };
  });
}

/** What share of the latest report was carried forward from the day before. */
export async function carriedShare(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(carried_forward) AS carried FROM price_daily
        WHERE price_date = (SELECT MAX(price_date) FROM price_daily)`,
    )
    .first<{ total: number; carried: number }>();
  if (!row?.total) return null;
  return Math.round((row.carried / row.total) * 1000) / 10;
}

/** Counts for the statistics strip. */
export async function siteStats(
  db: D1Database,
): Promise<{ rows: number; days: number; commodities: number; districts: number }> {
  const rows = await db.prepare(`SELECT COUNT(*) AS c FROM price_daily`).first<{ c: number }>();
  const days = await db.prepare(`SELECT COUNT(DISTINCT price_date) AS c FROM price_daily`).first<{ c: number }>();
  const commodities = await db.prepare(`SELECT COUNT(*) AS c FROM commodity`).first<{ c: number }>();
  const districts = await db.prepare(`SELECT COUNT(*) AS c FROM district`).first<{ c: number }>();
  return {
    rows: rows?.c ?? 0,
    days: days?.c ?? 0,
    commodities: commodities?.c ?? 0,
    districts: districts?.c ?? 0,
  };
}

/** The district with the most published rows, used as the home page's ledger. */
export async function busiestDistrict(db: D1Database): Promise<{ id: number; nameBn: string }> {
  const row = await db
    .prepare(
      `SELECT d.id AS id, d.name_bn AS name FROM price_latest p
         JOIN district d ON d.id = p.district_id
        WHERE p.upazila_id = 0 AND p.district_id > 0 AND p.retail_avg IS NOT NULL
        GROUP BY d.id ORDER BY COUNT(*) DESC LIMIT 1`,
    )
    .first<{ id: number; name: string }>();
  if (row) return { id: row.id, nameBn: row.name };
  const fallback = await db
    .prepare(`SELECT id, name_bn AS name FROM district WHERE id > 0 ORDER BY id LIMIT 1`)
    .first<{ id: number; name: string }>();
  return { id: fallback?.id ?? 47, nameBn: fallback?.name ?? "ঢাকা" };
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
