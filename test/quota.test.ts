import { afterEach, describe, expect, it, vi } from "vitest";
import { cronTick, HISTORY_DAYS } from "../src/ingest";
import type { Env } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

/**
 * The read budget.
 *
 * D1's free tier allows 5,000,000 rows read per day. The cron fires every
 * minute, so anything the tick reads is read 1,440 times a day. On
 * 2026-10-21 the price table held 11,594 rows and the tick read all of it
 * on every tick — about 16.7 million rows a day, three times the budget,
 * and the quota was gone by 14:04 UTC.
 *
 * These tests are about the *number of statements*, not about the numbers
 * they return. A budget is a count.
 */

const AGGREGATE_KEY = "agg:current";

function aggregates(days: number): Record<string, unknown> {
  return {
    latestDate: "2026-10-19",
    firstDate: "2026-06-23",
    days,
    rowCount: 11594,
    commodityCount: 447,
    districtCount: 64,
    commoditiesWithData: 256,
    districtsWithData: 64,
    upazilaCount: 505,
    carriedPct: 12.5,
    busiestDistrictId: 47,
    busiestDistrictName: "ঢাকা",
  };
}

function envWith(
  d1: ReturnType<typeof fakeD1>,
  kv: ReturnType<typeof fakeKV>,
): Env {
  return {
    DB: d1.db,
    CACHE: kv.kv,
    SITE_ORIGIN: "https://example.test",
    SOURCE_NAME: "কৃষি মন্ত্রণালয় / DAM",
    SOURCE_API: "https://upstream.test/agri-service",
  } as unknown as Env;
}

/** A D1 that answers the three tables the tick touches, and nothing else. */
function d1WithJob(job: unknown, priceTableDays = 4) {
  return fakeD1([
    (sql) => (sql.includes("FROM ingest_job") ? { results: job ? [{ job_json: JSON.stringify(job) }] : [] } : null),
    (sql) =>
      sql.includes("FROM ingest_run")
        ? { results: [{ d: new Date().toISOString().slice(0, 10) }] }
        : null,
    (sql) =>
      sql.includes("FROM price_daily")
        ? { results: [{ first: "2026-06-23", last: "2026-10-19", days: priceTableDays }] }
        : null,
  ]);
}

const UPSTREAM_ROW = {
  com_grp_id: 26,
  commodity_id: 602,
  com_subgrp_id: 190,
  unit_retail: 2,
  unit_wholesale: 1,
  w_avgPriceAvg: "7250",
  r_avgPriceAvg: "80",
  r_lowestPrice: "68",
  r_highestPrice: "91",
  w_lowestPrice: "6133",
  w_highestPrice: "8367",
};

function stubUpstream(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("market-daily-price-report")) {
        return new Response(
          JSON.stringify({ success: true, message: "data found!", data: [UPSTREAM_ROW] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the per-minute tick does not spend the read budget", () => {
  it("reads the price table not at all when there is nothing to do", async () => {
    const d1 = d1WithJob(null);
    const kv = fakeKV({ [AGGREGATE_KEY]: aggregates(HISTORY_DAYS) });
    const env = envWith(d1, kv);

    const result = await cronTick(env);

    expect(result.action).toBe("idle");
    // The whole point: an idle minute costs no rows.
    expect(d1.readsOf("price_daily")).toEqual([]);
  });

  it("reads the price table once for a whole batch of districts, not once per district", async () => {
    stubUpstream();
    const running = {
      id: "job_test",
      kind: "backfill",
      priceDates: ["2026-10-19"],
      dateIndex: 0,
      districtIndex: 0,
      districts: [1, 2, 3, 4, 5, 6, 7, 8],
      rowsWritten: 0,
      districtsOk: 0,
      districtsMissing: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: 0,
      status: "running",
    };
    const d1 = d1WithJob(running);
    const kv = fakeKV({ [AGGREGATE_KEY]: aggregates(HISTORY_DAYS) });
    const env = envWith(d1, kv);

    await cronTick(env);

    const reads = d1.readsOf("price_daily");
    // One statement for the four districts in the batch, not four.
    expect(reads.length).toBeLessThanOrEqual(1);
  });

  it("keeps working when the database refuses the read", async () => {
    // The quota is spent, so the history check cannot be answered. The tick
    // must not fall over: the daily refresh still has work to do.
    const d1 = d1WithJob(null);
    const original = d1.db.prepare.bind(d1.db);
    d1.db.prepare = ((sql: string) => {
      if (sql.includes("price_daily")) {
        return {
          sql,
          bind: () => ({
            first: async () => {
              throw new Error("D1 read limit exceeded");
            },
            all: async () => {
              throw new Error("D1 read limit exceeded");
            },
            run: async () => {
              throw new Error("D1 read limit exceeded");
            },
          }),
          first: async () => {
            throw new Error("D1 read limit exceeded");
          },
          all: async () => {
            throw new Error("D1 read limit exceeded");
          },
          run: async () => {
            throw new Error("D1 read limit exceeded");
          },
        } as unknown as D1PreparedStatement;
      }
      return original(sql);
    }) as typeof d1.db.prepare;

    const kv = fakeKV({ [AGGREGATE_KEY]: aggregates(3) });
    const env = envWith(d1, kv);

    // It must not throw.
    const result = await cronTick(env);
    expect(result.action).toBeTruthy();
  });

  it("verifies a thin history against the database, but only once a day", async () => {
    // The cache says the history is thinner than it should be; the database
    // says it is fine. The tick must pay for that answer once, not once a
    // minute.
    const d1 = d1WithJob(null, HISTORY_DAYS);
    const kv = fakeKV({ [AGGREGATE_KEY]: aggregates(3) });
    const env = envWith(d1, kv);

    await cronTick(env);
    const afterFirst = d1.readsOf("price_daily").length;
    expect(afterFirst).toBeGreaterThan(0);

    // The second tick in the same day must not pay for the same answer.
    d1.reset();
    await cronTick(env);
    expect(d1.readsOf("price_daily")).toEqual([]);
  });
});
