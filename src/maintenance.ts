/**
 * The worker's own schema upkeep.
 *
 * WHY THE WORKER DOES THIS ITSELF
 * -------------------------------
 * Migration 0004 adds the indexes that turn a full table scan into a
 * lookup. On 2026-10-21 it could not be applied, because the D1 read
 * quota — the very thing the indexes exist to protect — was already spent.
 * The quota resets at 00:00 UTC, which is 06:00 in Bangladesh, and waiting
 * for a human to be awake is not an operating model.
 *
 * So the worker applies its own indexes, on a daily cron, once the quota
 * is back. `CREATE INDEX IF NOT EXISTS` is idempotent, and a failure is
 * reported rather than swallowed: the ingest stays paused until the index
 * is really there, because a backfill without it would read the whole
 * price table for every batch of districts.
 */

import type { Env } from "./types";

export interface RequiredIndex {
  name: string;
  sql: string;
}

/**
 * The indexes of migration 0004.
 *
 * This list and `migrations/0004_indexes.sql` say the same thing, and a
 * test fails if they ever drift apart.
 */
export const REQUIRED_INDEXES: RequiredIndex[] = [
  {
    name: "idx_pl_commodity",
    sql: "CREATE INDEX IF NOT EXISTS idx_pl_commodity ON price_latest(commodity_id, district_id)",
  },
  {
    name: "idx_pl_district",
    sql: "CREATE INDEX IF NOT EXISTS idx_pl_district ON price_latest(district_id, upazila_id)",
  },
  {
    name: "idx_pd_date_district",
    sql: "CREATE INDEX IF NOT EXISTS idx_pd_date_district ON price_daily(price_date, district_id, commodity_id)",
  },
  {
    name: "idx_pd_district_commodity",
    sql: "CREATE INDEX IF NOT EXISTS idx_pd_district_commodity ON price_daily(district_id, commodity_id, price_date)",
  },
  {
    name: "idx_ingest_scope",
    sql: "CREATE INDEX IF NOT EXISTS idx_ingest_scope ON ingest_run(scope, status, price_date)",
  },
];

const STATE_KEY = "maintenance:schema";

export interface RequiredColumn {
  table: string;
  name: string;
  sql: string;
}

/**
 * The columns the quota machinery needs.
 *
 * `license.period` is the calendar month the counter belongs to, so the
 * allowance can roll over without a scheduled job. SQLite cannot add a
 * column conditionally, so the check is done here instead.
 */
export const REQUIRED_COLUMNS: RequiredColumn[] = [
  { table: "license", name: "period", sql: "ALTER TABLE license ADD COLUMN period TEXT" },
];

export interface MaintenanceResult {
  at: string;
  /** Indexes this run created. */
  created: string[];
  /** Indexes that were already there. */
  present: string[];
  /** Columns this run added. */
  columnsAdded: string[];
  /** Indexes or columns that could not be created, with the reason. */
  failed: string[];
}

/**
 * Are the indexes in place?
 *
 * A backfill without them reads the whole price table for every batch of
 * districts, which is how the read budget gets spent. So the backfill waits
 * until they are there.
 */
export async function hasRequiredIndexes(env: Env): Promise<boolean> {
  const names = REQUIRED_INDEXES.map((i) => i.name);
  const placeholders = names.map(() => "?").join(",");
  try {
    const { results } = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${placeholders})`)
      .bind(...names)
      .all<{ name: string }>();
    const present = new Set((results ?? []).map((r) => String(r.name)));
    return names.every((n) => present.has(n));
  } catch {
    // If the catalogue cannot be read, the indexes are not to be trusted.
    return false;
  }
}

/**
 * Make sure the schema the code depends on is actually there.
 *
 * The check reads a handful of rows from the schema catalogue, which is
 * the cheapest query in the database. The creates are idempotent, so a
 * second run costs the same and changes nothing.
 */
export async function ensureSchema(env: Env): Promise<MaintenanceResult> {
  const names = REQUIRED_INDEXES.map((i) => i.name);
  const placeholders = names.map(() => "?").join(",");
  const existing = new Set<string>();

  try {
    const { results } = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${placeholders})`)
      .bind(...names)
      .all<{ name: string }>();
    for (const r of results ?? []) existing.add(String(r.name));
  } catch {
    // If the catalogue cannot be read, try the creates anyway. They are
    // idempotent, so a false "missing" costs nothing but a statement.
  }

  const created: string[] = [];
  const present: string[] = [];
  const columnsAdded: string[] = [];
  const failed: string[] = [];

  for (const index of REQUIRED_INDEXES) {
    if (existing.has(index.name)) {
      present.push(index.name);
      continue;
    }
    try {
      await env.DB.prepare(index.sql).run();
      created.push(index.name);
    } catch (err) {
      failed.push(`${index.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const column of REQUIRED_COLUMNS) {
    try {
      const { results } = await env.DB
        .prepare(`PRAGMA table_info(${column.table})`)
        .all<{ name: string }>();
      const presentColumns = new Set((results ?? []).map((r) => String(r.name)));
      if (presentColumns.has(column.name)) continue;
      await env.DB.prepare(column.sql).run();
      columnsAdded.push(`${column.table}.${column.name}`);
    } catch (err) {
      failed.push(`${column.table}.${column.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const result: MaintenanceResult = { at: new Date().toISOString(), created, present, columnsAdded, failed };
  try {
    await env.CACHE.put(STATE_KEY, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch {
    /* the recorded state is a convenience, never a requirement */
  }
  return result;
}

/** The last recorded maintenance outcome, if there is one. */
export async function maintenanceState(env: Env): Promise<MaintenanceResult | null> {
  try {
    const raw = await env.CACHE.get(STATE_KEY, "json");
    return (raw as MaintenanceResult) ?? null;
  } catch {
    return null;
  }
}
