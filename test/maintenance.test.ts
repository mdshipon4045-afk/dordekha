import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_INDEXES, ensureSchema, hasRequiredIndexes } from "../src/maintenance";
import type { Env } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

/**
 * The worker keeps its own schema.
 *
 * Migration 0004 adds the indexes that turn a full table scan into a lookup.
 * It could not be applied on 2026-10-21 because the D1 read quota — the very
 * thing the indexes exist to protect — was already spent, and the quota
 * resets at 00:00 UTC. Waiting for a human to be awake at 06:00 BD is not
 * an operating model, so the worker applies them itself, once the quota is
 * back.
 */

describe("the worker keeps its own indexes", () => {
  it("says whether the indexes are in place", async () => {
    const withIndexes = fakeD1([
      (sql) =>
        sql.includes("sqlite_master")
          ? { results: REQUIRED_INDEXES.map((i) => ({ name: i.name })) }
          : null,
    ]);
    const withoutIndexes = fakeD1([
      (sql) => (sql.includes("sqlite_master") ? { results: [] } : null),
    ]);

    expect(await hasRequiredIndexes({ DB: withIndexes.db } as never)).toBe(true);
    expect(await hasRequiredIndexes({ DB: withoutIndexes.db } as never)).toBe(false);
  });

  it("creates an index that is missing", async () => {
    const d1 = fakeD1([
      (sql) => (sql.includes("sqlite_master") ? { results: [] } : null),
    ]);
    const kv = fakeKV();
    const env = { DB: d1.db, CACHE: kv.kv } as unknown as Env;

    const result = await ensureSchema(env);

    expect(result.failed).toEqual([]);
    expect(result.created.length).toBe(REQUIRED_INDEXES.length);
    for (const index of REQUIRED_INDEXES) {
      expect(d1.allOf(index.name).length).toBeGreaterThan(0);
    }
  });

  it("does nothing when every index is already there", async () => {
    const d1 = fakeD1([
      (sql) =>
        sql.includes("sqlite_master")
          ? { results: REQUIRED_INDEXES.map((i) => ({ name: i.name })) }
          : null,
      (sql) => (sql.includes("table_info") ? { results: [{ name: "period" }] } : null),
    ]);
    const kv = fakeKV();
    const env = { DB: d1.db, CACHE: kv.kv } as unknown as Env;

    const result = await ensureSchema(env);

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.present.length).toBe(REQUIRED_INDEXES.length);
    // Nothing was written to the database.
    expect(d1.statements.filter((s) => s.kind === "write")).toEqual([]);
  });

  it("reports the failure instead of pretending the index is there", async () => {
    const d1 = fakeD1([
      (sql) => (sql.includes("sqlite_master") ? { results: [] } : null),
    ]);
    // A statement that fails, standing in for "the quota is still spent".
    const original = d1.db.prepare.bind(d1.db);
    let seen = 0;
    d1.db.prepare = ((sql: string) => {
      if (/^create index/i.test(sql.trim())) {
        seen++;
        return {
          sql,
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => {
              throw new Error("D1 read limit exceeded");
            },
          }),
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => {
            throw new Error("D1 read limit exceeded");
          },
        } as unknown as D1PreparedStatement;
      }
      return original(sql);
    }) as typeof d1.db.prepare;

    const kv = fakeKV();
    const env = { DB: d1.db, CACHE: kv.kv } as unknown as Env;

    const result = await ensureSchema(env);

    expect(seen).toBeGreaterThan(0);
    expect(result.created).toEqual([]);
    expect(result.failed.length).toBe(REQUIRED_INDEXES.length);
  });

  it("records the outcome where the state can be read without the logs", async () => {
    const d1 = fakeD1([
      (sql) => (sql.includes("sqlite_master") ? { results: [] } : null),
    ]);
    const kv = fakeKV();
    const env = { DB: d1.db, CACHE: kv.kv } as unknown as Env;

    await ensureSchema(env);

    const raw = kv.get("maintenance:schema");
    expect(raw).toBeTruthy();
    const state = JSON.parse(String(raw));
    expect(state.created.length).toBe(REQUIRED_INDEXES.length);
    expect(state.at).toBeTruthy();
  });

  it("adds the column the monthly quota needs when it is missing", async () => {
    // The counter rolls over by month, so the licence row has to remember
    // which month it belongs to.
    const d1 = fakeD1([
      (sql) => (sql.includes("table_info") ? { results: [] } : null),
      (sql) => (sql.includes("sqlite_master") ? { results: [] } : null),
    ]);
    const kv = fakeKV();
    const env = { DB: d1.db, CACHE: kv.kv } as unknown as Env;

    const result = await ensureSchema(env);

    expect(result.columnsAdded).toContain("license.period");
    expect(d1.allOf("ADD COLUMN").length).toBeGreaterThan(0);
  });

  it("leaves the column alone when it is already there", async () => {
    const d1 = fakeD1([
      (sql) => (sql.includes("table_info") ? { results: [{ name: "period" }] } : null),
      (sql) => (sql.includes("sqlite_master") ? { results: [] } : null),
    ]);
    const kv = fakeKV();
    const env = { DB: d1.db, CACHE: kv.kv } as unknown as Env;

    const result = await ensureSchema(env);

    expect(result.columnsAdded).toEqual([]);
    expect(d1.allOf("ADD COLUMN")).toEqual([]);
  });
});

describe("the index list and the migration file cannot drift apart", () => {
  it("matches migration 0004 exactly", () => {
    const sql = readFileSync(resolve(process.cwd(), "migrations", "0004_indexes.sql"), "utf8");
    const fromFile = [...sql.matchAll(/CREATE INDEX IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1]!);
    expect(fromFile.length).toBeGreaterThan(0);
    expect(REQUIRED_INDEXES.map((i) => i.name).sort()).toEqual(fromFile.sort());

    // Whitespace is not a difference in meaning.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const index of REQUIRED_INDEXES) {
      expect(norm(sql)).toContain(norm(index.sql));
    }
  });
});
