import { describe, expect, it } from "vitest";
import {
  getHistoryDates,
  getHistoryForDate,
  getHistoryRows,
  setHistoryDate,
  type HistoryRow,
} from "../src/cache";
import type { Env } from "../src/types";
import { fakeKV } from "./helpers/fake-env";

/**
 * The history cache has to be able to hold more than a year of prices.
 *
 * One key held the whole history: 1.92 MB for three days, and KV allows
 * 25 MB for a value. At that rate the value would have failed at about
 * forty days, and the site would have started claiming a history it could
 * no longer serve.
 *
 * So the history is sharded by date and district — one key per district per
 * day, about ten kilobytes each — and a small manifest says which days
 * exist. A day of sixty-four districts costs sixty-four writes, which the
 * free tier can afford, and the trend of one commodity in one district costs
 * one read per day instead of a scan.
 */

function row(date: string, district: number, commodity: number, avg: number): HistoryRow {
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

function envWith() {
  const kv = fakeKV();
  return { env: { CACHE: kv.kv, DB: {} } as unknown as Env, kv };
}

describe("the history cache", () => {
  it("keeps a day of prices and gives them back unchanged", async () => {
    const { env } = envWith();
    const rows = [row("2026-10-19", 47, 602, 80), row("2026-10-19", 47, 833, 45)];

    await setHistoryDate(env, "2026-10-19", rows);

    const back = await getHistoryForDate(env, "2026-10-19");
    expect(back).toHaveLength(2);
    expect(back[0]!.c).toBe(602);
    expect(back[1]!.ravg).toBe(45);
  });

  it("splits a day across shards, one per district", async () => {
    const { env, kv } = envWith();
    const rows = [
      row("2026-10-19", 47, 602, 80),
      row("2026-10-19", 43, 602, 82),
      row("2026-10-19", 10, 602, 84),
    ];

    await setHistoryDate(env, "2026-10-19", rows);

    // One key per district, plus the manifest.
    const keys = [...kv.store.keys()].filter((k) => k.startsWith("history:"));
    expect(keys.length).toBe(4);
    expect(keys.some((k) => k.includes("47"))).toBe(true);
    expect(keys.some((k) => k.includes("10"))).toBe(true);
  });

  it("lists the days it holds, oldest first", async () => {
    const { env } = envWith();
    await setHistoryDate(env, "2026-10-19", [row("2026-10-19", 47, 602, 80)]);
    await setHistoryDate(env, "2026-10-17", [row("2026-10-17", 47, 602, 78)]);
    await setHistoryDate(env, "2026-10-18", [row("2026-10-18", 47, 602, 79)]);

    const dates = await getHistoryDates(env);
    expect(dates).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
  });

  it("replaces a day rather than adding to it", async () => {
    const { env } = envWith();
    await setHistoryDate(env, "2026-10-19", [row("2026-10-19", 47, 602, 80)]);
    await setHistoryDate(env, "2026-10-19", [row("2026-10-19", 47, 602, 80), row("2026-10-19", 43, 602, 81)]);

    const back = await getHistoryForDate(env, "2026-10-19");
    expect(back).toHaveLength(2);
  });

  it("finds one commodity in one district across the days it holds", async () => {
    const { env } = envWith();
    await setHistoryDate(env, "2026-10-18", [row("2026-10-18", 47, 602, 79), row("2026-10-18", 43, 602, 81)]);
    await setHistoryDate(env, "2026-10-19", [row("2026-10-19", 47, 602, 80), row("2026-10-19", 43, 602, 82)]);

    const series = await getHistoryRows(env, 602, 47);
    expect(series.map((r) => r.ravg)).toEqual([79, 80]);
    expect(series.map((r) => r.t)).toEqual(["2026-10-18", "2026-10-19"]);
  });

  it("says nothing when it holds nothing", async () => {
    const { env } = envWith();
    expect(await getHistoryDates(env)).toEqual([]);
    expect(await getHistoryForDate(env, "2026-10-19")).toEqual([]);
    expect(await getHistoryRows(env, 602, 47)).toEqual([]);
  });

  it("still serves the old single-key history while the new one fills up", async () => {
    const { env, kv } = envWith();
    // The shape the earlier release wrote: one key with every row.
    kv.store.set(
      "history:snapshot",
      JSON.stringify({ rows: [row("2026-10-19", 47, 602, 80)] }),
    );

    expect(await getHistoryDates(env)).toEqual(["2026-10-19"]);
    const series = await getHistoryRows(env, 602, 47);
    expect(series).toHaveLength(1);
    expect(series[0]!.ravg).toBe(80);
  });

  it("keeps a day in the cache for long enough to be worth keeping", async () => {
    // The shards used to live two days, so the cache held two days of
    // history while the database held a hundred and twenty, and the site's
    // claim about how far back it reached was the shorter of the two.
    const { env, kv } = envWith();

    await setHistoryDate(env, "2026-10-19", [row("2026-10-19", 47, 602, 80)]);

    const shardTtl = kv.ttls.get("history:date:2026-10-19:47");
    const manifestTtl = kv.ttls.get("history:index");
    expect(shardTtl).toBeTruthy();
    expect(manifestTtl).toBeTruthy();
    // At least a week, and the free tier holds a thousand keys while a day
    // costs sixty-four of them.
    expect(shardTtl!).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
    expect(manifestTtl!).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
  });
});
