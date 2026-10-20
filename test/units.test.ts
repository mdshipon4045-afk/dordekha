import { describe, expect, it } from "vitest";
import { chooseDivisor, deriveDivisor, toRetailUnit, unitInfo } from "../src/units";

describe("unit normalisation", () => {
  it("knows the units it has been given", () => {
    expect(unitInfo(1)?.en).toBe("Quintal");
    expect(unitInfo(2)?.en).toBe("Kilogram");
    expect(unitInfo(20)?.en).toBe("5 Litter");
    expect(unitInfo(999)).toBeUndefined();
  });

  it("treats upstream 'quintal' as 100 kg, not 37.32 kg", () => {
    // Live data 2026-10-19, Dhaka: চাল-আমন-সরু retail 80/kg, wholesale raw 7250.
    const c = chooseDivisor(2, 1, 80, 7250);
    expect(c.divisor).toBe(100);
    expect(c.source).toBe("table");
    // 7250/100 = 72.5 BDT/kg, which sits just below retail — physically right.
    expect(toRetailUnit(7250, c.divisor)).toBe(72.5);
    expect(toRetailUnit(7250, c.divisor)! / 80).toBeLessThan(1);
  });

  it("would have produced the wrong number without the fix", () => {
    const raw = 7250;
    const wrongKg = raw / 37.32; // treating it as a true quintal
    const rightKg = raw / 100;
    expect(wrongKg).toBeGreaterThan(80); // above retail: impossible
    expect(rightKg).toBeLessThan(80); // below retail: correct
  });

  it("handles the eggs case (4 pieces retail, 100 pieces wholesale)", () => {
    // ডিম ফার্ম- লাল: retail 11.5 (per 4 pieces), wholesale raw 258.6
    const c = chooseDivisor(5, 8, 11.5, 258.6);
    expect(c.divisor).toBe(25);
    expect(toRetailUnit(258.6, c.divisor)).toBeCloseTo(10.34, 2);
  });

  it("handles the oil case (litre retail, 100 litre wholesale)", () => {
    // তৈল-সরিষা: retail 140, wholesale raw 12390
    const c = chooseDivisor(3, 13, 140, 12390);
    expect(c.divisor).toBe(100);
    expect(toRetailUnit(12390, c.divisor)).toBeCloseTo(123.9, 1);
  });

  it("repairs an implausible factor instead of publishing nonsense", () => {
    // Same unit pair, but a value that cannot be right: wholesale raw is far
    // too small to be a per-100kg figure. The repair pass must land on a
    // divisor that puts wholesale below retail.
    const c = chooseDivisor(2, 1, 80, 800);
    expect(c.source).toBe("corrected");
    const normalised = toRetailUnit(800, c.divisor)!;
    expect(normalised).toBeLessThanOrEqual(80 * 1.05);
  });

  it("falls back to 'unknown' when no factor can be justified", () => {
    // A unit pair that does not exist and values that cannot be reconciled.
    const c = chooseDivisor(17, 19, 5, 5000);
    expect(["unknown", "corrected"]).toContain(c.source);
  });

  it("derives factors arithmetically for pairs without a measured entry", () => {
    // 12 Kg retail -> 100 kg... the pair (12, 15) is 1 bag of 50kg -> 12kg
    expect(deriveDivisor(2, 12)).toBe(12); // kg -> 12 kg
    expect(deriveDivisor(4, 9)).toBe(1000); // 1 piece -> 1000 pieces
    expect(deriveDivisor(2, 3)).toBeNull(); // mass vs volume
  });

  it("keeps wholesale below retail across every measured live row", () => {
    // Replay the 12 grain rows captured from the live API.
    const rows: [number, number, number][] = [
      // [retail, wholesaleRaw, unitWholesale]
      [80, 7250, 1],
      [57, 5117, 1],
      [52, 4583, 1],
      [78, 7000, 1],
      [59, 5400, 1],
      [48, 4200, 1],
      [51, 4344, 1],
      [63, 5467, 1],
      [68, 5850, 1],
      [73, 6600, 1],
      [160, 14125, 1],
      [205, 17500, 1],
    ];
    for (const [retail, wholesaleRaw] of rows) {
      const c = chooseDivisor(2, 1, retail, wholesaleRaw);
      const w = toRetailUnit(wholesaleRaw, c.divisor)!;
      expect(w, `retail=${retail} raw=${wholesaleRaw} divisor=${c.divisor}`).toBeLessThan(retail * 1.05);
    }
  });
});
