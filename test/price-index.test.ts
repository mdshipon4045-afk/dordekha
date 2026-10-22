import { describe, expect, it } from "vitest";
import { commodityMedians } from "../src/db";
import type { Env } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

/**
 * The price index.
 *
 * It used to take Dhaka's figure for every commodity, so the three hundred
 * and fifty commodities that Dhaka did not report showed an empty price —
 * and the column said "average retail price", which is not what one
 * district's figure is.
 *
 * The figure is the median across the districts that reported, with the
 * outliers left out, and it must survive the database being unreadable.
 */

function envWith(d1: ReturnType<typeof fakeD1>, kv: ReturnType<typeof fakeKV>): Env {
  return {
    DB: d1.db,
    CACHE: kv.kv,
    SITE_ORIGIN: "https://example.test",
    SOURCE_NAME: "কৃষি মন্ত্রণালয় / DAM",
    SOURCE_API: "https://upstream.test/agri-service",
  } as unknown as Env;
}

describe("the national figure of each commodity", () => {
  it("is the median across the districts that reported", async () => {
    const d1 = fakeD1([
      (sql) =>
        sql.includes("FROM price_latest")
          ? {
              results: [
                { c: 696, avg: 300, unit: 2 },
                { c: 696, avg: 400, unit: 2 },
                { c: 696, avg: 500, unit: 2 },
                { c: 602, avg: 80, unit: 2 },
              ],
            }
          : null,
    ]);
    const env = envWith(d1, fakeKV());

    const medians = await commodityMedians(env);

    expect(medians.get(696)?.median).toBe(400);
    expect(medians.get(696)?.districts).toBe(3);
    expect(medians.get(602)?.median).toBe(80);
  });

  it("leaves a figure that is far out of range out of the count", async () => {
    // The upstream occasionally carries a figure that is off by two orders
    // of magnitude. One bad row must not define the commodity.
    const d1 = fakeD1([
      (sql) =>
        sql.includes("FROM price_latest")
          ? {
              results: [
                { c: 833, avg: 40, unit: 2 },
                { c: 833, avg: 45, unit: 2 },
                { c: 833, avg: 44, unit: 2 },
                { c: 833, avg: 2275, unit: 2 },
              ],
            }
          : null,
    ]);
    const env = envWith(d1, fakeKV());

    const medians = await commodityMedians(env);

    expect(medians.get(833)?.median).toBe(44);
    // The outlier is not counted as a district.
    expect(medians.get(833)?.districts).toBe(3);
  });

  it("answers from the cache when the database cannot be read", async () => {
    const d1 = fakeD1([
      (sql) => {
        if (sql.includes("FROM price_latest")) throw new Error("D1 read limit exceeded");
        return null;
      },
    ]);
    const kv = fakeKV({
      "snapshot:latest": JSON.stringify({
        rows: [
          { d: 47, c: 696, t: "2026-10-19", ravg: 368, rmin: 335, rmax: 400, ru: 2 },
          { d: 2, c: 696, t: "2026-10-19", ravg: 315, rmin: 280, rmax: 350, ru: 2 },
        ],
      }),
    });
    const env = envWith(d1, kv);

    const medians = await commodityMedians(env);

    expect(medians.get(696)?.median).toBe(315);
    expect(medians.get(696)?.districts).toBe(2);
  });

  it("says nothing for a commodity that has no price", async () => {
    const d1 = fakeD1([(sql) => (sql.includes("FROM price_latest") ? { results: [] } : null)]);
    const env = envWith(d1, fakeKV());

    const medians = await commodityMedians(env);

    expect(medians.size).toBe(0);
  });
});
