import { describe, expect, it } from "vitest";
import { resolve, findInText } from "../src/resolve";

const list = [
  { id: 1, nameBn: "পেঁয়াজ", nameEn: "Onion" },
  { id: 2, nameBn: "পেঁয়াজ (আলী)", nameEn: "Onion (Local)" },
  { id: 3, nameBn: "পেঁয়াজ (নতুন)", nameEn: "Onion (New)" },
  { id: 4, nameBn: "আলু (দেশীয়)", nameEn: "Potato (Local)" },
  { id: 5, nameBn: "চাল - আমন - সরু", nameEn: "Rice - Aman-Fine" },
  { id: 6, nameBn: "চাল -বোরো - হাইব্রিড - মাঝারি", nameEn: "Rice - Boro - Hybrid - Medium" },
];

describe("resolve", () => {
  it("prefers an exact name over a longer one", () => {
    const r = resolve(list, "পেঁয়াজ");
    expect(r.match?.id).toBe(1);
    expect(r.ambiguous).toBe(false);
  });

  it("reports ambiguity when several candidates tie", () => {
    const r = resolve(list, "চাল");
    expect(r.ambiguous).toBe(true);
    expect(r.tied.length).toBeGreaterThan(1);
  });

  it("breaks ties deterministically by id", () => {
    const a = resolve(list, "চাল");
    const b = resolve(list, "চাল");
    expect(a.match?.id).toBe(b.match?.id);
  });

  it("matches across the two Bengali spellings", () => {
    const r = resolve(list, "পেঁয়াজ");
    expect(r.match?.nameEn).toBe("Onion");
  });

  it("matches English names too", () => {
    const r = resolve(list, "potato");
    expect(r.match?.id).toBe(4);
  });

  it("returns nothing for an unknown word", () => {
    const r = resolve(list, "ড্রোন");
    expect(r.match).toBeNull();
    expect(r.tied).toHaveLength(0);
  });
});

describe("findInText", () => {
  it("finds the commodity inside a sentence", () => {
    const r = findInText(list, "পেঁয়াজ ৬০ টাকা ঢাকায়");
    expect(r.match?.id).toBe(1);
  });

  it("finds a variety inside a sentence", () => {
    const r = findInText(list, "আলু (দেশীয়) কত টাকা");
    expect(r.match?.id).toBe(4);
  });

  it("returns nothing when no name appears", () => {
    const r = findInText(list, "আজ সোনার দাম কত");
    expect(r.match).toBeNull();
  });
});
