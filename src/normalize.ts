/**
 * Normalisation: turn raw upstream rows into records we are willing to publish.
 *
 * The guiding rule of this service: **never publish a number we cannot trace.**
 * Every field here either comes straight from the official source or is
 * explicitly flagged.
 */

import type { PriceRecord, PriceTriple } from "./types";
import { chooseDivisor, toRetailUnit } from "./units";

/** Raw row shape returned by the DAM daily price report. */
export interface RawUpstreamRow {
  com_grp_id: number;
  commodity_id: number;
  com_subgrp_id: number;
  unit_retail: number;
  unit_wholesale: number;
  w_avgPriceAvg?: string;
  r_avgPriceAvg?: string;
  r_lowestPrice?: string;
  r_highestPrice?: string;
  w_lowestPrice?: string;
  w_highestPrice?: string;
  [k: string]: unknown;
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Convert Bangla numerals to ASCII and strip thousands separators. */
export function toAsciiNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  let out = "";
  for (const ch of s) {
    const idx = BANGLA_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  out = out.replace(/[,\s]/g, "");
  if (out === "" || out === "-" || out === "--") return null;

  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

export interface NormalizeContext {
  priceDate: string;
  districtId: number;
  upazilaId: number | null;
  /**
   * The same commodity/district/place observed on the previous reported day.
   * Used to detect upstream values that were simply copied forward.
   */
  previous?: { retailAvg: number | null; wholesaleAvg: number | null } | null;
}

/**
 * Normalise one upstream row.
 *
 * Wholesale handling:
 *  - the raw figure is a bulk price covering `divisor` retail units;
 *  - the divisor is chosen from measured evidence, then validated against the
 *    physical expectation that wholesale sits below retail;
 *  - if no factor can be justified the row is flagged as an anomaly and the
 *    wholesale side is withheld rather than published wrong.
 */
export function normalizeRow(raw: RawUpstreamRow, ctx: NormalizeContext): PriceRecord {
  const retailAvg = toAsciiNumber(raw.r_avgPriceAvg);
  const retailMin = toAsciiNumber(raw.r_lowestPrice);
  const retailMax = toAsciiNumber(raw.r_highestPrice);
  const rawWholesaleAvg = toAsciiNumber(raw.w_avgPriceAvg);
  const rawWholesaleMin = toAsciiNumber(raw.w_lowestPrice);
  const rawWholesaleMax = toAsciiNumber(raw.w_highestPrice);

  let anomaly: string | null = null;

  const choice = chooseDivisor(raw.unit_retail, raw.unit_wholesale, retailAvg, rawWholesaleAvg);
  if (choice.source === "unknown") {
    anomaly = `unit-pair ${raw.unit_retail}>${raw.unit_wholesale} যাচাই করা যায়নি`;
  } else if (choice.source === "corrected") {
    // The figure was physically impossible under the measured factor, so it
    // was rescaled. We publish the rescaled number but say so, because a
    // silent repair is exactly the kind of thing a price service must not do.
    anomaly = `ইউনিট সংশোধিত: ${choice.note}`;
  }

  const retail: PriceTriple | null =
    retailAvg === null
      ? null
      : {
          min: retailMin,
          max: retailMax,
          avg: retailAvg,
          unitId: raw.unit_retail,
          rawUnitId: raw.unit_retail,
          divisor: 1,
          divisorSource: "table",
        };

  // The wholesale figure is divided down to the retail unit, so that is the
  // unit it is *in*. Labelling it with the upstream's own unit ("quintal")
  // while the number is per kilogram is how a price service starts lying.
  const wholesale: PriceTriple | null =
    rawWholesaleAvg === null
      ? null
      : {
          min: toRetailUnit(rawWholesaleMin, choice.divisor),
          max: toRetailUnit(rawWholesaleMax, choice.divisor),
          avg: toRetailUnit(rawWholesaleAvg, choice.divisor),
          unitId: raw.unit_retail,
          rawUnitId: raw.unit_wholesale,
          divisor: choice.divisor,
          divisorSource: choice.source,
        };

  // Physical sanity: wholesale per retail unit must sit below retail.
  if (wholesale?.avg != null && retail?.avg != null && retail.avg > 0) {
    const ratio = wholesale.avg / retail.avg;
    if (ratio > 1.05) {
      anomaly = anomaly ?? `পাইকারি/খুচরা অনুপাত অস্বাভাবিক (${ratio.toFixed(2)})`;
    }
  }

  // Upstream sometimes repeats yesterday's numbers. Detect and mark it so
  // the UI can show "as of" instead of implying a change.
  //
  // The comparison has to be like-for-like: the stored previous value is
  // already unit-normalised, so the current figure is compared after
  // normalisation too. Comparing the raw wholesale against the normalised
  // one would never match and the signal would be silently lost.
  const carriedForward =
    ctx.previous != null &&
    retailAvg !== null &&
    ctx.previous.retailAvg !== null &&
    retailAvg === ctx.previous.retailAvg &&
    wholesale?.avg != null &&
    ctx.previous.wholesaleAvg != null &&
    Math.abs(wholesale.avg - ctx.previous.wholesaleAvg) < 0.01;

  return {
    priceDate: ctx.priceDate,
    districtId: ctx.districtId,
    upazilaId: ctx.upazilaId,
    commodityId: raw.commodity_id,
    commodityGroupId: raw.com_grp_id,
    commoditySubGroupId: raw.com_subgrp_id,
    retail,
    wholesale,
    carriedForward,
    anomaly,
  };
}

/** Bulk-normalise a batch of upstream rows for one place/date. */
export function normalizeBatch(
  rows: RawUpstreamRow[],
  ctx: Omit<NormalizeContext, "previous">,
  previousByCommodity?: Map<number, { retailAvg: number | null; wholesaleAvg: number | null }>,
): PriceRecord[] {
  const out: PriceRecord[] = [];
  for (const raw of rows) {
    const prev = previousByCommodity?.get(raw.commodity_id) ?? null;
    out.push(normalizeRow(raw, { ...ctx, previous: prev }));
  }
  return out;
}

/** Format a BDT amount for display in Bangla. */
export function formatBdt(n: number | null | undefined, fractionDigits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const fixed = n.toFixed(fractionDigits);
  const [int = "0", frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const bn = grouped.replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d);
  return frac && frac !== "00" ? `${bn}.${frac.replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d)}` : bn;
}

/** Convert an ASCII number string to Bangla digits. */
export function toBanglaDigits(input: string): string {
  return input.replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d);
}
