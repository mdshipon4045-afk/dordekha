import { afterEach, describe, expect, it, vi } from "vitest";
import { setHistoryDate, type HistoryRow } from "../src/cache";
import { historyForOrSnapshot } from "../src/db";
import { advance, cronTick, startBackfill } from "../src/ingest";
import type { Env, MasterData } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

/**
 * The history has to reach as far back as the site says it does.
 *
 * The cache holds the recent days only: a shard lives two days, and the
 * free tier holds a thousand keys, so the whole history cannot live there.
 * The database holds the rest. The trend used to stop at whatever the cache
 * held — two days — while the site claimed a hundred, and the backfill that
 * fills the database was invisible to everyone.
 *
 * These tests are about the three ways that went wrong:
 *
 *   1. the trend stopped at the cache and never asked the database;
 *   2. the backfill collected the days it already had, and so never reached
 *      the ones it did not have;
 *   3. the backfill held the job for days, and the site waited for
 *      yesterday's price in the meantime.
 */

function historyRow(date: string, district: number, commodity: number, avg: number): HistoryRow {
  return {
    t: date,
    d: district,
    c: commodity,
    rmin: avg - 2,
    rmax: avg + 2,
    ravg: avg,
    ru: 2,
    wmin: avg - 4,
    wmax: avg - 1,
    wavg: avg - 2,
    wu: 2,
    wru: 1,
    wdiv: 100,
    wdivsrc: "table",
    cf: 0,
    an: null,
  };
}

function dbRow(date: string, district: number, commodity: number, avg: number) {
  return {
    price_date: date,
    district_id: district,
    upazila_id: 0,
    commodity_id: commodity,
    group_id: 0,
    sub_group_id: 0,
    retail_min: avg - 2,
    retail_max: avg + 2,
    retail_avg: avg,
    retail_unit: 2,
    wholesale_min: avg - 4,
    wholesale_max: avg - 1,
    wholesale_avg: avg - 2,
    wholesale_unit: 2,
    wholesale_raw_unit: 1,
    wholesale_divisor: 100,
    wholesale_divisor_src: "table",
    carried_forward: 0,
    anomaly: null,
  };
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

function master(districts: number[]): MasterData {
  return {
    districts: districts.map((id) => ({
      id,
      nameBn: `জেলা ${id}`,
      nameEn: `District ${id}`,
      divisionId: 1,
    })),
    upazilas: [],
    commodities: [
      { id: 602, nameBn: "পেঁয়াজ", nameEn: "Onion", groupId: 26, subGroupId: 190, unitRetail: 2, unitWholesale: 1 },
    ],
    groups: [{ id: 26, nameBn: "শাকসবজি", nameEn: "Vegetables" }],
    units: { 2: { bn: "কেজি", en: "kg" }, 1: { bn: "কেজি", en: "kg" } },
    fetchedAt: new Date().toISOString(),
  };
}

function envWith(d1: ReturnType<typeof fakeD1>, kv: ReturnType<typeof fakeKV>): Env {
  return {
    DB: d1.db,
    CACHE: kv.kv,
    SITE_ORIGIN: "https://example.test",
    SOURCE_NAME: "কৃষি মন্ত্রণালয় / DAM",
    SOURCE_API: "https://upstream.test/agri-service",
  } as unknown as Env;
}

describe("the trend reaches the whole history", () => {
  it("completes the cached days with the days the database holds", async () => {
    const d1 = fakeD1([
      (sql) =>
        sql.includes("FROM price_daily") && sql.includes("commodity_id = ?")
          ? { results: [dbRow("2026-07-01", 47, 602, 81), dbRow("2026-06-25", 47, 602, 80)] }
          : null,
    ]);
    const kv = fakeKV();
    const env = envWith(d1, kv);

    // The cache holds the two recent days.
    await setHistoryDate(env, "2026-10-18", [historyRow("2026-10-18", 47, 602, 82)]);
    await setHistoryDate(env, "2026-10-19", [historyRow("2026-10-19", 47, 602, 83)]);

    const series = await historyForOrSnapshot(env, 602, 47, "2026-06-01", 400);

    const dates = series.map((r) => r.priceDate).sort();
    expect(dates).toEqual(["2026-06-25", "2026-07-01", "2026-10-18", "2026-10-19"]);
  });

  it("does not ask the database when the cache already covers the range", async () => {
    const d1 = fakeD1([
      (sql) =>
        sql.includes("FROM price_daily") && sql.includes("commodity_id = ?")
          ? { results: [dbRow("2026-07-01", 47, 602, 81)] }
          : null,
    ]);
    const kv = fakeKV();
    const env = envWith(d1, kv);

    await setHistoryDate(env, "2026-10-18", [historyRow("2026-10-18", 47, 602, 82)]);
    await setHistoryDate(env, "2026-10-19", [historyRow("2026-10-19", 47, 602, 83)]);

    // The range starts where the cache starts, so the cache answers it.
    const series = await historyForOrSnapshot(env, 602, 47, "2026-10-18", 400);

    expect(series.map((r) => r.priceDate)).toEqual(["2026-10-19", "2026-10-18"]);
    expect(d1.readsOf("price_daily")).toEqual([]);
  });
});

describe("the backfill", () => {
  it("lets the daily refresh come first when the history is thin", async () => {
    // The history is thinner than it should be, so a backfill wants to
    // start. The daily price comes first: a site that shows an old price is
    // broken, while a site that reaches back fewer days is merely short.
    stubUpstream();
    const d1 = fakeD1([
      // The last daily sweep finished three days ago, so the refresh is due.
      (sql) => (sql.includes("MAX(finished_at)") ? { results: [{ at: "2026-10-19T00:00:00Z" }] } : null),
      (sql) =>
        sql.includes("FROM price_daily")
          ? { results: [{ first: "2026-06-23", last: "2026-10-19", days: 3 }] }
          : null,
    ]);
    const kv = fakeKV({ "agg:current": { days: 3 }, "ingest:master": master([47]) });
    const env = envWith(d1, kv);

    const result = await cronTick(env);

    expect(result.action).toBe("started");
    expect(result.action).not.toBe("backfill");
  });

  it("collects only the days it does not have", async () => {
    stubUpstream();
    const d1 = fakeD1([
      // The days a sweep has already finished.
      (sql) =>
        sql.includes("FROM ingest_run") && sql.includes("DISTINCT")
          ? { results: [{ d: "2026-06-25" }, { d: "2026-06-26" }] }
          : null,
      // The newest completed report, so the daily refresh is not due.
      (sql) =>
        sql.includes("MAX(price_date)") ? { results: [{ d: new Date().toISOString().slice(0, 10) }] } : null,
    ]);
    const kv = fakeKV({ "ingest:master": master([47]) });
    const env = envWith(d1, kv);

    const job = await startBackfill(env);

    expect(job.priceDates).not.toContain("2026-06-25");
    expect(job.priceDates).not.toContain("2026-06-26");
    // The calendar still holds the days that are missing.
    expect(job.priceDates.length).toBeGreaterThan(100);
  });

  it("gives way to the daily refresh between days", async () => {
    stubUpstream();
    const d1 = fakeD1([
      // The newest completed report is old, so yesterday's price is due.
      (sql) => (sql.includes("MAX(price_date)") ? { results: [{ d: "2026-10-19" }] } : null),
      (sql) => (sql.includes("FROM price_daily") ? { results: [] } : null),
    ]);
    const kv = fakeKV();
    const env = envWith(d1, kv);

    const job = {
      id: "job_backfill",
      kind: "backfill" as const,
      priceDates: ["2026-10-19"],
      dateIndex: 0,
      districtIndex: 0,
      districts: [47],
      rowsWritten: 0,
      districtsOk: 0,
      districtsMissing: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: 0,
      status: "running" as const,
    };

    const after = await advance(env, job);

    expect(after.status).toBe("done");
    expect(after.error).toMatch(/daily refresh/);
  });
});
