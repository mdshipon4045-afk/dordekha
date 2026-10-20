import { describe, expect, it } from "vitest";
import { buildDigest, escapeHtml } from "../src/telegram";

const base = {
  date: "2026-10-19",
  origin: "https://dordekha.pages.dev",
  sourceName: "কৃষি মন্ত্রণালয় / DAM",
  featured: ["পেঁয়াজ"],
};

describe("telegram digest", () => {
  it("renders a headline price with the unit", () => {
    const text = buildDigest({
      ...base,
      rows: [
        {
          commodityBn: "পেঁয়াজ",
          districtBn: "ঢাকা",
          retail: { min: 43, max: 47, avg: 45, unitBn: "কিলোগ্রাম" },
          wholesale: { avg: 38 },
          carriedForward: false,
        },
      ],
    });
    expect(text).toContain("পেঁয়াজ");
    expect(text).toContain("ঢাকা");
    expect(text).toContain("৪৩–৪৭");
    expect(text).toContain("কিলোগ্রাম");
    expect(text).toContain("পাইকারি ৩৮");
  });

  it("marks a carried-forward row instead of implying a change", () => {
    const text = buildDigest({
      ...base,
      rows: [
        {
          commodityBn: "পেঁয়াজ",
          districtBn: "ঢাকা",
          retail: { min: 43, max: 47, avg: 45, unitBn: "কিলোগ্রাম" },
          wholesale: { avg: 38 },
          carriedForward: true,
        },
      ],
    });
    expect(text).toContain("আগের দিনের মান");
  });

  it("prefers a freshly reported district over a carried-forward one", () => {
    const text = buildDigest({
      ...base,
      rows: [
        {
          commodityBn: "পেঁয়াজ",
          districtBn: "ঢাকা",
          retail: { min: 43, max: 47, avg: 45, unitBn: "কিলোগ্রাম" },
          wholesale: { avg: 38 },
          carriedForward: true,
        },
        {
          commodityBn: "পেঁয়াজ",
          districtBn: "রাজশাহী",
          retail: { min: 38, max: 42, avg: 40, unitBn: "কিলোগ্রাম" },
          wholesale: { avg: 34 },
          carriedForward: false,
        },
      ],
    });
    // The fresh row is used, and it is not marked as carried forward.
    expect(text).toContain("রাজশাহী");
    expect(text).not.toContain("আগের দিনের মান");
  });

  it("always cites the source and links onward", () => {
    const text = buildDigest({ ...base, rows: [] });
    expect(text).toContain("কৃষি মন্ত্রণালয়");
    expect(text).toContain("https://dordekha.pages.dev/");
    expect(text).toContain("যেকোনো দাবি যাচাই করুন");
  });

  it("says so when there is nothing to report", () => {
    const text = buildDigest({ ...base, rows: [] });
    expect(text).toContain("কোনো তথ্য নেই");
  });

  it("escapes HTML in names", () => {
    expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
});
