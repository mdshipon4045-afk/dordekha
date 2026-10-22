import { describe, expect, it } from "vitest";
import { verifyClaim } from "../src/mcp";
import type { CommodityRef, DistrictRef, Env, RenderContext } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

/**
 * Checking a claim.
 *
 * The machine-readable answer and the text have to say the same thing. A
 * client that reads `matches` and never reads the text must not get a
 * different answer from the one a reader sees.
 *
 * It did: `matches` allowed ten per cent of tolerance, so a claim of 48
 * against a published 43-47 said "matches" while the text said "মিলেনি".
 */

const COMMODITIES: CommodityRef[] = [
  { id: 833, nameBn: "পেঁয়াজ", nameEn: "Onion", groupId: 26, groupBn: "শাকসবজি", unitRetail: 2, unitWholesale: 1 },
];
const DISTRICTS: DistrictRef[] = [
  { id: 47, nameBn: "ঢাকা", nameEn: "Dhaka", divisionId: 3 },
];

function ctx(): RenderContext {
  return {
    origin: "https://dordekha.pages.dev",
    sourceName: "কৃষি মন্ত্রণালয় / DAM",
    latestDate: "2026-10-19",
  } as unknown as RenderContext;
}

function row(date: string, district: number, commodity: number, min: number, max: number, avg: number) {
  return {
    price_date: date,
    district_id: district,
    upazila_id: 0,
    commodity_id: commodity,
    group_id: 26,
    sub_group_id: 190,
    retail_min: min,
    retail_max: max,
    retail_avg: avg,
    retail_unit: 2,
    wholesale_min: 36,
    wholesale_max: 40,
    wholesale_avg: 38,
    wholesale_unit: 2,
    wholesale_raw_unit: 1,
    wholesale_divisor: 100,
    wholesale_divisor_src: "table",
    carried_forward: 0,
    anomaly: null,
  };
}

function envWith(): Env {
  const d1 = fakeD1([
    (sql) =>
      sql.includes("FROM price_latest") || sql.includes("FROM price_daily")
        ? { results: [row("2026-10-19", 47, 833, 43, 47, 45)] }
        : null,
    (sql) => (sql.includes("FROM unit") ? { results: [{ id: 2, name_bn: "কেজি", name_en: "kg" }] } : null),
  ]);
  const kv = fakeKV();
  return {
    DB: d1.db,
    CACHE: kv.kv,
    SITE_ORIGIN: "https://dordekha.pages.dev",
    SOURCE_NAME: "কৃষি মন্ত্রণালয় / DAM",
    SOURCE_API: "https://upstream.test/agri-service",
  } as unknown as Env;
}

describe("checking a claim against the record", () => {
  it("says the same thing in the field and in the text", async () => {
    const out = await verifyClaim(envWith(), ctx(), COMMODITIES, DISTRICTS, "পেঁয়াজ ৪৮ টাকা ঢাকায়");
    const sc = out.structuredContent as {
      verdict: string;
      matches: boolean | null;
      within_tolerance: boolean | null;
    };

    // The claim is outside 43-47, so it does not match.
    expect(sc.matches).toBe(false);
    expect(sc.verdict).toContain("মিলেনি");
    // It is within ten per cent, which is a different answer.
    expect(sc.within_tolerance).toBe(true);
  });

  it("says a claim inside the range matches", async () => {
    const out = await verifyClaim(envWith(), ctx(), COMMODITIES, DISTRICTS, "পেঁয়াজ ৪৫ টাকা ঢাকায়");
    const sc = out.structuredContent as { verdict: string; matches: boolean | null };

    expect(sc.matches).toBe(true);
    expect(sc.verdict).toContain("মিলেছে");
  });

  it("says a claim far off does not match", async () => {
    const out = await verifyClaim(envWith(), ctx(), COMMODITIES, DISTRICTS, "পেঁয়াজ ৯০ টাকা ঢাকায়");
    const sc = out.structuredContent as { matches: boolean | null; within_tolerance: boolean | null };

    expect(sc.matches).toBe(false);
    expect(sc.within_tolerance).toBe(false);
  });
});
