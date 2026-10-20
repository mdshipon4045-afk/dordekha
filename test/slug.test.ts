import { describe, expect, it } from "vitest";
import { commoditySlug, districtSlug, slugify, transliterate } from "../src/slug";

describe("slugs", () => {
  it("transliterates Bangla into readable ASCII", () => {
    expect(transliterate("পেঁয়াজ")).toContain("pe");
    expect(transliterate("ঢাকা")).toBe("dhaka");
    expect(transliterate("রাজশাহী")).toBe("rajshahi");
  });

  it("slugifies safely", () => {
    expect(slugify("Rice - Aman-Fine")).toBe("rice-aman-fine");
    // Strict transliteration: Bengali has no inherent schwa, so আমন is "amn".
    expect(slugify("আমন চাল - সরু")).toBe("amn-chal-sru");
    expect(slugify("  ***  ")).toBe("");
  });

  it("keeps Bengali digits as digits", () => {
    expect(slugify("দাম ২০২৬")).toBe("dam-2026");
  });

  it("transliterates Bengali without inventing vowels", () => {
    // Bengali has no inherent schwa, so দর is "dr", not "dor".
    expect(slugify("দর")).toBe("dr");
    expect(slugify("পেঁয়াজ")).toBe("penyaj");
  });

  it("gives distinct slugs to commodities sharing an English prefix", () => {
    const a = commoditySlug("চাল -আমন - সরু", "Rice - Aman-Fine", 602);
    const b = commoditySlug("চাল -আমন - মাঝারী", "Rice - Aman-Medium", 603);
    expect(a).not.toBe(b);
  });

  it("produces a usable district slug", () => {
    expect(districtSlug("পাবনা", "Pabna", 43)).toBe("pabna");
    expect(districtSlug("ঢাকা", "Dhaka", 47)).toBe("dhaka");
  });
});
