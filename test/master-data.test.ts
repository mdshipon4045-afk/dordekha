import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commodityRefs, replaceMasterData } from "../src/db";
import { refreshMaster } from "../src/ingest";
import type { Env, MasterData } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The master data has to survive the round trip.
 *
 * On 2026-10-21 the live site published every commodity with an empty
 * group and a null wholesale unit. The cause was a name that did not
 * match: the ingest wrote the wholesale unit to `unit_wholesale` and the
 * reader asked for `unit_whole_sale`. The column that was read existed
 * only because someone had added it by hand, and it was always empty, so
 * nothing failed loudly — the site just published less than it had.
 *
 * A silent omission is the worst kind of bug, so the round trip is now
 * tested against a database that has exactly the columns the migration
 * creates, and fails the way SQLite fails.
 */

/** The commodity table as `migrations/0001_init.sql` creates it. */
const COMMODITY_COLUMNS = [
  "id",
  "name_bn",
  "name_en",
  "group_id",
  "sub_group_id",
  "unit_retail",
  "unit_wholesale",
];

function master(): MasterData {
  return {
    districts: [{ id: 47, nameBn: "ঢাকা", nameEn: "Dhaka", divisionId: 3 }],
    upazilas: [],
    commodities: [
      {
        id: 602,
        nameBn: "চাল -আমন - সরু",
        nameEn: "Rice - Aman-Fine",
        groupId: 26,
        subGroupId: 190,
        unitRetail: 2,
        unitWholesale: 1,
      },
    ],
    groups: [{ id: 26, nameBn: "চাল", nameEn: "Rice" }],
    units: { 1: { bn: "কুইন্টাল", en: "Quintal" }, 2: { bn: "কিলোগ্রাম", en: "Kilogram" } },
    fetchedAt: "2026-10-21T00:00:00.000Z",
  };
}

describe("the master data survives the round trip", () => {
  it("reads back the columns it wrote", async () => {
    /** The rows the ingest wrote, keyed by table. */
    const written: Record<string, Record<string, unknown>> = {
      commodity: {},
      commodity_group: {},
    };
    let inserted = false;

    const d1 = fakeD1([
      (sql) => {
        if (/FROM commodity c/i.test(sql)) {
          // SQLite fails on a column the table does not have. So does this.
          for (const m of sql.matchAll(/c\.(\w+)/g)) {
            if (!COMMODITY_COLUMNS.includes(m[1]!)) {
              throw new Error(`no such column: c.${m[1]}`);
            }
          }
          const picked: Record<string, unknown> = {};
          for (const c of COMMODITY_COLUMNS) picked[c] = written.commodity![c] ?? null;
          // The join brings the group's own name.
          if (/commodity_group/i.test(sql)) {
            picked.group_bn = written.commodity_group!.name_bn ?? null;
          }
          return { results: [picked] };
        }
        return null;
      },
    ]);

    // The write, with the values the ingest would bind.
    const original = d1.db.prepare.bind(d1.db);
    d1.db.prepare = ((sql: string) => {
      const stmt = original(sql);
      const isCommodity = /INSERT OR REPLACE INTO commodity \(/i.test(sql);
      const isGroup = /INSERT OR REPLACE INTO commodity_group/i.test(sql);
      if (!isCommodity && !isGroup) return stmt;
      if (isCommodity) inserted = true;
      return {
        ...stmt,
        bind: (...args: unknown[]) => {
          if (isCommodity) {
            const [id, nameBn, nameEn, groupId, subGroupId, unitRetail, unitWholesale] = args;
            Object.assign(written.commodity!, {
              id,
              name_bn: nameBn,
              name_en: nameEn,
              group_id: groupId,
              sub_group_id: subGroupId,
              unit_retail: unitRetail,
              unit_wholesale: unitWholesale,
            });
          } else {
            const [id, nameBn, nameEn] = args;
            Object.assign(written.commodity_group!, { id, name_bn: nameBn, name_en: nameEn });
          }
          return (stmt as unknown as { bind: (...a: unknown[]) => unknown }).bind(...args);
        },
      } as unknown as D1PreparedStatement;
    }) as typeof d1.db.prepare;

    await replaceMasterData(d1.db, master());
    expect(inserted).toBe(true);

    // And the read.
    const refs = await commodityRefs({ DB: d1.db } as never);

    expect(refs.length).toBe(1);
    expect(refs[0]!.unitRetail).toBe(2);
    expect(refs[0]!.unitWholesale).toBe(1);
    expect(refs[0]!.groupId).toBe(26);
    // The group name the site publishes is the Bangla one.
    expect(refs[0]!.groupBn).toBe("চাল");
  });
});

describe("refreshing the master data", () => {
  it("refreshes the cached snapshot as well as the database", async () => {
    // A refresh that leaves the cache stale is how the site published an
    // empty group and a null wholesale unit for every commodity: the
    // database was correct and the cache was not.
    const dropdowns = {
      data: {
        divisionList: [{ value: 1, text_bn: "ঢাকা", text_en: "Dhaka" }],
        districtList: [{ value: 47, text_bn: "ঢাকা", text_en: "Dhaka", division_id: 1 }],
        upazilaList: [],
        commodityGroupList: [{ value: 26, text_bn: "চাল", text_en: "Rice" }],
        commodityNameList: [
          {
            value: 602,
            text_bn: "চাল -আমন - সরু",
            text_en: "Rice - Aman-Fine",
            commodity_group_id: 26,
            commodity_sub_group_id: 190,
            unit_retail: 2,
            unit_whole_sale: 1,
          },
        ],
        measurementUnitList: [
          { value: 1, text_bn: "কুইন্টাল", text_en: "Quintal" },
          { value: 2, text_bn: "কিলোগ্রাম", text_en: "Kilogram" },
        ],
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(dropdowns), { status: 200 })),
    );

    const d1 = fakeD1();
    const kv = fakeKV();
    const env = {
      DB: d1.db,
      CACHE: kv.kv,
      SOURCE_API: "https://upstream.test/agri-service",
    } as unknown as Env;

    await refreshMaster(env);

    const raw = kv.get("master:snapshot");
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(String(raw));
    expect(snapshot.commodities[0].groupBn).toBe("চাল");
    expect(snapshot.commodities[0].unitWholesale).toBe(1);
    expect(snapshot.commodities[0].groupId).toBe(26);
  });
});

describe("the read and the write agree on the column names", () => {
  it("no query names a column the migration does not create", () => {
    const sql = readFileSync(resolve(process.cwd(), "migrations", "0001_init.sql"), "utf8");
    const create = /CREATE TABLE IF NOT EXISTS commodity \(([\s\S]*?)\);/i.exec(sql);
    expect(create).not.toBeNull();
    const columns = [...create![1]!.matchAll(/^\s*(\w+)\s+(?:TEXT|INTEGER|REAL)/gim)].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThan(0);

    const db = readFileSync(resolve(process.cwd(), "src", "db.ts"), "utf8");
    // Only the SQL matters — the TypeScript property names are a different
    // thing entirely.
    const sqlBlocks = [...db.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
    for (const block of sqlBlocks) {
      if (!/\bFROM commodity\b/i.test(block)) continue;
      for (const m of block.matchAll(/c\.(\w+)/g)) {
        expect(columns).toContain(m[1]!);
      }
    }
  });
});
