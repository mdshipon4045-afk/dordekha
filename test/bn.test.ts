import { describe, expect, it } from "vitest";
import { bnIncludes, foldForCompare, matchScore, normalizeBn } from "../src/bn";

const cp = (n: number) => String.fromCodePoint(n);

// The two spellings of "onion" that matter:
//   decomposed  = ya + nukta   (U+09AF U+09BC) — what keyboards produce
//   precomposed = ya            (U+09DF)      — what the government feed uses
const DECOMPOSED = cp(0x09aa) + cp(0x09c7) + cp(0x09bc) + cp(0x09af) + cp(0x09bc) + cp(0x09be) + cp(0x09ac);
const PRECOMPOSED = cp(0x09aa) + cp(0x09c7) + cp(0x09bc) + cp(0x09df) + cp(0x09be) + cp(0x09ac);

describe("Bengali normalisation", () => {
  it("folds the decomposed nukta onto the precomposed letter", () => {
    expect(DECOMPOSED).not.toBe(PRECOMPOSED);
    expect(normalizeBn(DECOMPOSED)).toBe(PRECOMPOSED);
    expect(normalizeBn(PRECOMPOSED)).toBe(PRECOMPOSED);
  });

  it("makes the two spellings compare equal", () => {
    expect(bnIncludes(`${PRECOMPOSED} (আলী)`, DECOMPOSED)).toBe(true);
    expect(bnIncludes("চাল -আউশ - দেশীয়", "চাল")).toBe(true);
    expect(bnIncludes("আলু (দেশীয়)", DECOMPOSED)).toBe(false);
  });

  it("never matches an empty needle", () => {
    expect(bnIncludes("চাল", "")).toBe(false);
    expect(bnIncludes("চাল", null)).toBe(false);
  });

  it("collapses whitespace and strips zero-width characters", () => {
    expect(normalizeBn("  আমন   চাল  ")).toBe("আমন চাল");
    expect(normalizeBn(`${PRECOMPOSED.slice(0, 4)}‌${PRECOMPOSED.slice(4)}`)).toBe(PRECOMPOSED);
  });

  it("scores an exact match highest", () => {
    expect(matchScore("ঢাকা", "ঢাকা")).toBe(100);
    expect(matchScore("ঢাকা", "ঢাক")).toBe(90);
    expect(matchScore("চাল - আমন - সরু", "চাল - আমন")).toBe(90);
    expect(matchScore("চাল - আমন - সরু", "আমন")).toBe(70);
    expect(matchScore("চাল - আমন - সরু", "ধান")).toBe(0);
  });

  it("matches across the two spellings", () => {
    expect(matchScore(`${PRECOMPOSED} (আলী)`, DECOMPOSED)).toBeGreaterThanOrEqual(50);
    expect(matchScore(`${PRECOMPOSED} (আলী)`, PRECOMPOSED)).toBeGreaterThanOrEqual(50);
  });

  it("folds case for Latin text too", () => {
    expect(foldForCompare("Rice - Aman-Fine")).toBe("rice - aman-fine");
    expect(matchScore("Rice - Aman-Fine", "rice")).toBe(90);
  });
});
