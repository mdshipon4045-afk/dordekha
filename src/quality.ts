/**
 * Data quality: what may be published, and how it must be described.
 *
 * Three things the audit found, all real:
 *
 * 1. The source's "average" is not a mean. In 99.1% of rows it is exactly
 *    (min + max) / 2 — a midpoint of the reported range, not an average
 *    over the markets that reported. Publishing it as "গড়" (average)
 *    mislabels it.
 *
 * 2. In some rows the source's average falls outside its own min/max.
 *    Publishing a row where avg=195 and min=380 makes the whole service
 *    look broken.
 *
 * 3. The divisor that turns a bulk price into a per-retail-unit price is
 *    recorded per row, and it must travel with the row. A hard-coded 100
 *    would be a claim the data does not support.
 */

export interface RawPrice {
  min: number | null;
  max: number | null;
  avg: number | null;
  unit: number | null;
}

/** A price triple that is safe to publish, with an honest description. */
export interface CleanPrice {
  min: number | null;
  max: number | null;
  /**
   * The source's reported figure, clamped into the reported range. It is a
   * mid-range estimate, not a mean over markets — see `isMidpoint`.
   */
  avg: number | null;
  unit: number | null;
  /** True when the source's figure was simply (min+max)/2. */
  isMidpoint: boolean;
  /** Set when the source's figure fell outside its own range. */
  repaired: boolean;
  /** The source's own figure, before any repair. Never hidden. */
  sourceAvg: number | null;
  /** True when the source's min was larger than its max. */
  rangeSwapped: boolean;
}

/**
 * Make one price triple safe to publish.
 *
 * A figure outside its own min/max is clamped and flagged rather than
 * published as it stands, because a reader cannot make sense of it and an
 * assistant will quote it verbatim.
 */
export function cleanPrice(raw: RawPrice): CleanPrice {
  const { avg, unit } = raw;

  // The source sometimes reports a minimum larger than its maximum. Left
  // alone, a reader sees "130–15" and an assistant quotes it verbatim. The
  // two figures are swapped so the range reads correctly, and the row is
  // flagged — the source's own numbers are never silently discarded.
  const rangeSwapped =
    raw.min !== null && raw.max !== null && raw.min > raw.max;
  const min = rangeSwapped ? raw.max : raw.min;
  const max = rangeSwapped ? raw.min : raw.max;

  const hasRange = min !== null && max !== null && min !== max;

  if (avg === null) {
    return { min, max, avg: null, unit, isMidpoint: false, repaired: false, sourceAvg: null, rangeSwapped };
  }

  // The source reports a range; an average outside that range is a fault in
  // the source, and clamping is the least dishonest repair available.
  const repaired = hasRange && (avg < min! || avg > max!);
  const clamped = repaired ? Math.min(max!, Math.max(min!, avg)) : avg;

  const midpoint = hasRange ? Math.round(((min! + max!) / 2) * 100) / 100 : null;
  const isMidpoint =
    midpoint !== null && Math.abs(clamped - midpoint) <= Math.max(0.51, Math.abs(midpoint) * 0.01);

  return {
    min,
    max,
    avg: clamped,
    unit,
    isMidpoint,
    repaired,
    sourceAvg: avg,
    rangeSwapped,
  };
}

/** A short, honest description of what the published figure is. */
export function priceDescription(p: CleanPrice): string {
  if (p.avg === null) return "কোনো তথ্য নেই";
  if (p.repaired) return "উৎসের গড় ব্যাপ্তির বাইরে ছিল — সংশোধিত";
  if (p.isMidpoint) return "উৎসের প্রকাশিত মধ্যম-পরিমাণ (গড় নয়)";
  return "উৎসের প্রকাশিত গড়";
}

/**
 * The label the published figure gets.
 *
 * The source publishes a mid-range figure, not a mean over the markets that
 * reported — in 99% of rows it is exactly (min+max)/2. Calling that "গড়"
 * would be a mislabel, so the label says what it is.
 */
export function priceLabel(p: CleanPrice): string {
  if (p.avg === null) return "—";
  return p.isMidpoint ? "মধ্যম-পরিমাণ" : "গড়";
}

/**
 * The range of a distribution cannot be derived from a min and a max. So
 * when the source gives us a midpoint, the honest way to express the
 * uncertainty is the range itself.
 */
export function priceRangeText(p: CleanPrice, unitBn: string): string {
  if (p.min === null && p.max === null) return "—";
  if (p.min !== null && p.max !== null && p.min !== p.max) {
    return `${fmt(p.min)}–${fmt(p.max)} টাকা/${unitBn}`;
  }
  return `${fmt(p.avg ?? p.min)} টাকা/${unitBn}`;
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  const fixed = n.toFixed(2);
  const parts = fixed.split(".");
  const i = parts[0] ?? "0";
  const f = parts[1] ?? "00";
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const bn = grouped.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)] ?? d);
  return f !== "00" ? `${bn}.${f}` : bn;
}
