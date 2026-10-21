import { describe, expect, it } from "vitest";
import { extractKeywords, foldForCompare } from "../src/bn";
import { candidatesFor, pickByCoverage, resolve } from "../src/resolve";

describe("question parsing", () => {
  const eq = (a: string[], b: string[]) => {
    expect(a.map(foldForCompare)).toEqual(b.map(foldForCompare));
  };

  it("strips the scaffolding and keeps the noun", () => {
    eq(extractKeywords("আজ পেঁয়াজের দাম কত"), ["পেঁয়াজ"]);
    eq(extractKeywords("আজ ডিমের দাম কত"), ["ডিম"]);
    eq(extractKeywords("পেঁয়াজ ঢাকা"), ["পেঁয়াজ", "ঢাকা"]);
  });

  it("drops bare numbers — they are prices, not names", () => {
    eq(extractKeywords("আমি কি গরিব পেঁয়াজ ৬০ টাকা"), ["গরিব", "পেঁয়াজ"]);
    expect(extractKeywords("দাম ১২০ টাকা")).toEqual([]);
  });

  it("handles an empty query", () => {
    expect(extractKeywords("")).toEqual([]);
    expect(extractKeywords(null)).toEqual([]);
  });
});

describe("candidate selection", () => {
  const list = [
    { id: 1, nameBn: "পেঁয়াজ", nameEn: "Onion" },
    { id: 2, nameBn: "পেঁয়াজ- দেশীয়", nameEn: "Onion (Local)" },
    { id: 3, nameBn: "পেঁয়াজ (নতুন)", nameEn: "Onion (New)" },
    { id: 4, nameBn: "আলু (দেশীয়)", nameEn: "Potato (Local)" },
    { id: 5, nameBn: "চাল - আমন - সরু", nameEn: "Rice - Aman-Fine" },
    { id: 6, nameBn: "চালকুমড়া", nameEn: "Corn" },
  ];

  it("finds every candidate whose name contains the keyword", () => {
    const hits = candidatesFor(list, ["পেঁয়াজ"]);
    expect(hits.map((h) => h.id)).toEqual([1, 2, 3]);
  });

  it("matches across the two Bengali spellings", () => {
    const hits = candidatesFor(list, ["পেঁয়াজ"]);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("prefers the candidate with the most data, then the shortest name", () => {
    const coverage = new Map([
      [1, 60],
      [2, 55],
      [3, 58],
    ]);
    const picked = pickByCoverage(
      candidatesFor(list, ["পেঁয়াজ"]),
      coverage,
    );
    expect(picked.match?.id).toBe(1);
  });

  it("breaks a coverage tie with the shorter name", () => {
    const coverage = new Map([
      [1, 10],
      [2, 10],
      [3, 10],
    ]);
    const picked = pickByCoverage(candidatesFor(list, ["পেঁয়াজ"]), coverage);
    expect(picked.match?.id).toBe(1);
  });

  it("never picks a candidate with no data when one has data", () => {
    const coverage = new Map([
      [5, 40],
      [6, 3],
    ]);
    const picked = pickByCoverage(candidatesFor(list, ["চাল"]), coverage);
    expect(picked.match?.id).toBe(5);
  });

  it("does not match a compound word that merely starts the same way", () => {
    // "চালকুমড়া" is corn, not rice. The keyword must end on a word
    // boundary or it is a different product.
    const hits = candidatesFor(list, ["চাল"]).map((h) => h.id);
    expect(hits).toContain(5); // চাল - আমন - সরু
    expect(hits).not.toContain(6); // চালকুমড়া
  });
});

describe("resolve", () => {
  it("scores an exact name highest", () => {
    const list = [
      { id: 1, nameBn: "ঢাকা", nameEn: "Dhaka" },
      { id: 2, nameBn: "ঢাকা জেলা", nameEn: "Dhaka District" },
    ];
    expect(resolve(list, "ঢাকা").match?.id).toBe(1);
  });
});
