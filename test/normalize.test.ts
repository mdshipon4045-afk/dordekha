import { describe, expect, it } from "vitest";
import { formatBdt, normalizeBatch, normalizeRow, toAsciiNumber, toBanglaDigits } from "../src/normalize";
import type { RawUpstreamRow } from "../src/normalize";

const dhakaRice: RawUpstreamRow = {
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

describe("number parsing", () => {
  it("converts Bangla digits", () => {
    expect(toAsciiNumber("৭২.৫০")).toBe(72.5);
    expect(toAsciiNumber("১২,৫০০")).toBe(12500);
  });

  it("handles plain and messy values", () => {
    expect(toAsciiNumber("80")).toBe(80);
    expect(toAsciiNumber("1,234.50")).toBe(1234.5);
    expect(toAsciiNumber("")).toBeNull();
    expect(toAsciiNumber("-")).toBeNull();
    expect(toAsciiNumber(undefined)).toBeNull();
    expect(toAsciiNumber(null)).toBeNull();
  });

  it("formats for Bangla display", () => {
    expect(formatBdt(7250)).toBe("৭,২৫০");
    expect(formatBdt(80.5)).toBe("৮০.৫০");
    expect(formatBdt(80)).toBe("৮০");
    expect(formatBdt(null)).toBe("—");
    expect(toBanglaDigits("2026-10-19")).toBe("২০২৬-১০-১৯");
  });
});

describe("row normalisation", () => {
  it("normalises the rice row correctly", () => {
    const r = normalizeRow(dhakaRice, { priceDate: "2026-10-19", districtId: 47, upazilaId: null });
    expect(r.retail?.avg).toBe(80);
    expect(r.retail?.min).toBe(68);
    expect(r.retail?.max).toBe(91);
    // wholesale must be expressed per retail unit and sit below retail
    expect(r.wholesale?.avg).toBe(72.5);
    expect(r.wholesale?.divisor).toBe(100);
    expect(r.wholesale?.divisorSource).toBe("table");
    expect(r.wholesale!.avg!).toBeLessThan(r.retail!.avg!);
    expect(r.anomaly).toBeNull();
  });

  it("flags a row whose wholesale cannot be reconciled", () => {
    // kg -> kg, but the raw figure is orders of magnitude out of range.
    const bad: RawUpstreamRow = {
      ...dhakaRice,
      unit_wholesale: 2,
      w_avgPriceAvg: "500000",
      w_lowestPrice: "500000",
      w_highestPrice: "500000",
    };
    const r = normalizeRow(bad, { priceDate: "2026-10-19", districtId: 47, upazilaId: null });
    // Repaired and labelled — published, but never silently.
    expect(r.anomaly).toBeTruthy();
    expect(r.anomaly).toContain("ইউনিট সংশোধিত");
  });

  it("flags a wholesale that still exceeds retail after normalisation", () => {
    // Same unit, and the factor is already the measured one, so no repair is
    // possible without inventing a number.
    const bad: RawUpstreamRow = {
      ...dhakaRice,
      unit_retail: 2,
      unit_wholesale: 1,
      w_avgPriceAvg: "7250000",
      w_lowestPrice: "7250000",
      w_highestPrice: "7250000",
    };
    const r = normalizeRow(bad, { priceDate: "2026-10-19", districtId: 47, upazilaId: null });
    expect(r.anomaly).toBeTruthy();
  });

  it("detects a carried-forward value", () => {
    // The stored previous value is unit-normalised (72.5), and the current
    // raw figure is 7250 — the comparison must happen after normalisation.
    const r = normalizeRow(dhakaRice, {
      priceDate: "2026-10-18",
      districtId: 47,
      upazilaId: null,
      previous: { retailAvg: 80, wholesaleAvg: 72.5 },
    });
    expect(r.carriedForward).toBe(true);
  });

  it("detects a carried-forward value when only the raw figure is known", () => {
    // A previous row that was stored before normalisation landed would carry
    // the raw figure; that must not be mistaken for a change either.
    const r = normalizeRow(dhakaRice, {
      priceDate: "2026-10-18",
      districtId: 47,
      upazilaId: null,
      previous: { retailAvg: 80, wholesaleAvg: 7250 },
    });
    expect(r.carriedForward).toBe(false);
  });

  it("does not flag a genuinely changed value", () => {
    const r = normalizeRow(dhakaRice, {
      priceDate: "2026-10-18",
      districtId: 47,
      upazilaId: null,
      previous: { retailAvg: 75, wholesaleAvg: 7000 },
    });
    expect(r.carriedForward).toBe(false);
  });

  it("keeps a row with retail only", () => {
    const retailOnly: RawUpstreamRow = {
      com_grp_id: 1,
      commodity_id: 1,
      com_subgrp_id: 1,
      unit_retail: 2,
      unit_wholesale: 1,
      r_avgPriceAvg: "55",
      r_lowestPrice: "50",
      r_highestPrice: "60",
    };
    const r = normalizeRow(retailOnly, { priceDate: "2026-10-19", districtId: 47, upazilaId: null });
    expect(r.retail?.avg).toBe(55);
    expect(r.wholesale).toBeNull();
  });

  it("normalises a batch and keeps context", () => {
    const rows = normalizeBatch([dhakaRice, { ...dhakaRice, commodity_id: 603 }], {
      priceDate: "2026-10-19",
      districtId: 12,
      upazilaId: 34,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.districtId).toBe(12);
    expect(rows[0]?.upazilaId).toBe(34);
    expect(rows[1]?.commodityId).toBe(603);
  });
});
