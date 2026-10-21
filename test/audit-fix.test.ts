import { describe, expect, it } from "vitest";
import { cleanPrice, priceLabel } from "../src/quality";
import { foldForCompare, wordSet } from "../src/bn";
import { findAllInText, findInText } from "../src/resolve";

/**
 * Regression tests for the findings of the 21 October 2026 audit.
 *
 * Each test names the finding it covers, because a test without a reason
 * is a test that gets deleted the next time it is inconvenient.
 */

describe("cleanPrice — the published triple is safe to publish", () => {
  it("তাৎ-৬: swaps a source range that is the wrong way round", () => {
    // The source itself published min 130, max 15 for tomato.
    const p = cleanPrice({ min: 130, max: 15, avg: 72.5, unit: 2 });
    expect(p.min).toBe(15);
    expect(p.max).toBe(130);
    expect(p.rangeSwapped).toBe(true);
  });

  it("তাৎ-৬: clamps an average that fell outside its own range, and keeps the source's figure", () => {
    // The source's average came from all markets, including ones that
    // reported nothing; the range only covers the markets that did.
    const p = cleanPrice({ min: 380, max: 400, avg: 195, unit: 2 });
    expect(p.avg).toBe(380);
    expect(p.avg).toBeGreaterThanOrEqual(p.min!);
    expect(p.avg).toBeLessThanOrEqual(p.max!);
    expect(p.repaired).toBe(true);
    expect(p.sourceAvg).toBe(195);
  });

  it("তাৎ-৭: recognises the source's mid-range estimate as a midpoint", () => {
    const p = cleanPrice({ min: 43, max: 47, avg: 45, unit: 2 });
    expect(p.isMidpoint).toBe(true);
    expect(priceLabel(p)).toBe("মধ্যম-পরিমাণ");
  });

  it("তাৎ-৭: does not call a real average a midpoint", () => {
    const p = cleanPrice({ min: 40, max: 50, avg: 44, unit: 2 });
    expect(p.isMidpoint).toBe(false);
    expect(priceLabel(p)).toBe("গড়");
  });

  it("leaves a row with a figure but no range alone", () => {
    const p = cleanPrice({ min: null, max: null, avg: 340, unit: 2 });
    expect(p.avg).toBe(340);
    expect(p.min).toBeNull();
    expect(p.repaired).toBe(false);
  });
});

describe("foldForCompare — the spellings people actually type", () => {
  it("তাৎ-২৩: folds তৈল to তেল", () => {
    expect(foldForCompare("তৈল- সয়াবিন(খোলা)")).toContain("তেল");
    expect(foldForCompare("তেল")).toBe(foldForCompare("তৈল"));
  });

  it("তাৎ-২৩: folds the two spellings of পেঁয়াজ", () => {
    expect(foldForCompare("পিঁয়াজ")).toBe(foldForCompare("পেঁয়াজ"));
  });

  it("does not fold a word that merely contains one", () => {
    // "তৈলক" is not oil; the fold must not reach into longer words.
    expect(foldForCompare("তৈলক")).not.toBe(foldForCompare("তেলক"));
  });

  it("splits a phrase into comparable words", () => {
    expect(wordSet("সয়াবিন তেল")).toEqual(wordSet("সয়াবিন তেল"));
  });
});

describe("findAllInText — every product the claim names", () => {
  const catalogue = [
    { id: 831, nameBn: "পেঁয়াজ - আলী", nameEn: "Onion (local)" },
    { id: 832, nameBn: "পেঁয়াজ - আমদানি", nameEn: "Onion-imported" },
    { id: 833, nameBn: "পেঁয়াজ", nameEn: "Onion (New)" },
    { id: 818, nameBn: "তৈল- সয়াবিন(খোলা)", nameEn: "Soybean Oil(loose)" },
    { id: 602, nameBn: "চাল - আমন - সরু", nameEn: "Rice - Aman-Fine" },
  ];

  it("তাৎ-৩: keeps the local onion as a candidate, not just the one whose name matches exactly", () => {
    const r = findAllInText(catalogue, "পেঁয়াজ ৬০ টাকা ঢাকায়");
    const ids = r.all.map((c) => c.id);
    expect(ids).toContain(831);
    expect(ids).toContain(833);
  });

  it("তাৎ-৩: ranks the exact name above the head-word match", () => {
    const r = findAllInText(catalogue, "পেঁয়াজ ৬০ টাকা ঢাকায়");
    expect(r.match?.id).toBe(833);
  });

  it("তাৎ-২৩: matches an oil asked for by its other spelling", () => {
    const r = findAllInText(catalogue, "সয়াবিন তেল");
    expect(r.all.map((c) => c.id)).toContain(818);
  });

  it("তাৎ-২২: matches an English district name inside a claim", () => {
    const districts = [
      { id: 47, nameBn: "ঢাকা", nameEn: "Dhaka" },
      { id: 10, nameBn: "চট্টগ্রাম", nameEn: "Chattogram" },
    ];
    const r = findInText(districts, "onion 60 taka in dhaka");
    expect(r.match?.id).toBe(47);
  });

  it("তাৎ-২২: still matches a Bangla district name", () => {
    const districts = [
      { id: 47, nameBn: "ঢাকা", nameEn: "Dhaka" },
      { id: 10, nameBn: "চট্টগ্রাম", nameEn: "Chattogram" },
    ];
    const r = findInText(districts, "পেঁয়াজ ৬০ টাকা ঢাকায়");
    expect(r.match?.id).toBe(47);
  });
});
