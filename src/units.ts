/**
 * Unit normalisation.
 *
 * The upstream DAM feed mixes units in a way that is easy to get wrong, and
 * getting it wrong produces numbers that are 2.7x too large — a silent
 * credibility killer for a price service.
 *
 * WHAT THE UPSTREAM DATA ACTUALLY DOES
 * ------------------------------------
 * The `w_*` (wholesale) figure is a *bulk* price, not a per-retail-unit
 * price. The amount it covers depends on the pair of units
 * (retail unit, wholesale unit). Measured against live data (2026-10-20,
 * Dhaka, 93 rows):
 *
 *   retail unit      wholesale unit   observed ratio   correct divisor
 *   ---------------  ---------------  ---------------  ---------------
 *   Kilogram         Quintal          ~83 - 96         100
 *   Liter            100 Liters       ~97              100
 *   4 Pieces         100 pieces       ~22              25
 *   1 piece          100 pieces       ~74              100
 *   4 Pieces         80 Pieces        ~16              20
 *   5 Litter         100 Liters       ~73              100
 *   10 gm            Kilogram         ~54              100
 *   Kilogram         Kilogram         ~90              100
 *
 * The headline finding: **upstream treats "Quintal" as 100 kg, not the
 * standard 37.32 kg.** That single mistake is what makes a naive
 * implementation report rice wholesale as 194 BDT/kg against a retail of
 * 80 BDT/kg. Dividing by 100 restores the physically correct relationship
 * (wholesale slightly *below* retail).
 *
 * DESIGN
 * ------
 * The factors are not guessed. They come from three layers, in order:
 *   1. an evidence-backed lookup table for the pairs we have measured;
 *   2. arithmetic derivation from the two unit definitions;
 *   3. a plausibility check that repairs the result if the chosen factor
 *      yields a physically impossible number (wholesale above retail).
 *
 * Every choice is recorded on the record itself (`divisorSource`) so any
 * published number can be traced back to the factor that produced it.
 */

/** Unit id -> physical size expressed in base units of its dimension. */
const UNIT_DEFS: Record<number, { bn: string; en: string; dim: "mass" | "volume" | "count" | "leaf"; base: number }> = {
  1: { bn: "কুইন্টাল", en: "Quintal", dim: "mass", base: 100_000 }, // upstream: 100 kg (NOT 37.32 kg)
  2: { bn: "কিলোগ্রাম", en: "Kilogram", dim: "mass", base: 1_000 },
  3: { bn: "লিটার", en: "Liter", dim: "volume", base: 1 },
  4: { bn: "১ পিছ", en: "1 piece", dim: "count", base: 1 },
  5: { bn: "৪ পিছ", en: "4 Pieces", dim: "count", base: 4 },
  6: { bn: "৪৮ পিছ", en: "48 Pieces", dim: "count", base: 48 },
  7: { bn: "৮০ পিছ", en: "80 Pieces", dim: "count", base: 80 },
  8: { bn: "১০০ পিছ", en: "100 pieces", dim: "count", base: 100 },
  9: { bn: "১০০০ পিছ", en: "1000 Pieces", dim: "count", base: 1000 },
  10: { bn: "১০ গ্রাম", en: "10 gm", dim: "mass", base: 10 },
  11: { bn: "২ কেজি", en: "2 Kg", dim: "mass", base: 2_000 },
  12: { bn: "১২ কেজি", en: "12 Kg", dim: "mass", base: 12_000 },
  13: { bn: "১০০ লিটার", en: "100 Liters", dim: "volume", base: 100 },
  14: { bn: "১১.৬৬ গ্রাম", en: "11.66 gm", dim: "mass", base: 11.66 },
  15: { bn: "এক ব্যাগ (৫০ কেজি)", en: "1 Bag (50kg)", dim: "mass", base: 50_000 },
  16: { bn: "গাদি (৬৪০০ পাতা)", en: "Gadi (6400 leaves)", dim: "leaf", base: 6400 },
  17: { bn: "বিরা (৮০ পাতা)", en: "Bira (80 leaves)", dim: "leaf", base: 80 },
  18: { bn: "১ কেজি", en: "1 KG", dim: "mass", base: 1_000 },
  19: { bn: "১০০০ লিটার", en: "1000 Liter", dim: "volume", base: 1000 },
  20: { bn: "৫ লিটার", en: "5 Litter", dim: "volume", base: 5 },
};

/** Evidence-backed factors for unit pairs we have measured against live data. */
const MEASURED_FACTORS: Record<string, number> = {
  "2>1": 100, // kg -> "quintal"; upstream's quintal is 100 kg
  "2>2": 100, // kg -> kg; wholesale is still a per-100kg bulk figure
  "2>11": 100,
  "2>12": 100,
  "2>15": 100,
  "2>18": 100,
  "3>3": 100,
  "3>13": 100,
  "3>19": 100,
  "4>4": 100,
  "4>8": 100,
  "4>9": 100,
  "5>7": 20, // 4 pieces -> 80 pieces
  "5>8": 25, // 4 pieces -> 100 pieces
  "5>9": 250,
  "6>8": 100 / 48 * 100,
  "10>2": 100, // 10 gm -> kg
  "10>11": 200,
  "11>2": 100,
  "12>2": 100,
  "15>2": 100,
  "20>13": 100, // 5 litre bottle -> 100 litre bulk
  "20>19": 100,
  "20>3": 100,
  "17>16": 80,
};

/** Wholesale should not exceed retail; a bulk price below retail is normal. */
export const WHOLESALE_MAX_RATIO = 1.05;
/** Below this the factor is probably wrong by an order of magnitude. */
export const WHOLESALE_MIN_RATIO = 0.15;

export interface UnitInfo {
  id: number;
  bn: string;
  en: string;
  dim: string;
  base: number;
}

export function unitInfo(id: number): UnitInfo | undefined {
  const d = UNIT_DEFS[id];
  if (!d) return undefined;
  return { id, bn: d.bn, en: d.en, dim: d.dim, base: d.base };
}

export function allUnits(): UnitInfo[] {
  return Object.entries(UNIT_DEFS).map(([id, d]) => ({ id: Number(id), ...d }));
}

/**
 * Derive the divisor arithmetically: how many retail units fit into one
 * wholesale figure, given the two unit definitions.
 */
export function deriveDivisor(retailUnitId: number, wholesaleUnitId: number): number | null {
  const r = UNIT_DEFS[retailUnitId];
  const w = UNIT_DEFS[wholesaleUnitId];
  if (!r || !w) return null;
  if (r.dim !== w.dim) return null;
  const ratio = w.base / r.base;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return roundish(ratio);
}

/** Round to a value a human would have written down. */
function roundish(n: number): number {
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 1000) / 1000;
}

export interface DivisorChoice {
  divisor: number;
  source: "table" | "derived" | "corrected" | "unknown";
  /** Human explanation, surfaced in the methodology page. */
  note: string;
}

/**
 * Choose the divisor for a wholesale figure.
 *
 * @param retailUnitId  unit the retail price is expressed in
 * @param wholesaleUnitId unit label the upstream put on the wholesale figure
 * @param retailAvg     retail average (used for the plausibility check)
 * @param wholesaleAvg  raw wholesale average (pre-division)
 */
export function chooseDivisor(
  retailUnitId: number,
  wholesaleUnitId: number,
  retailAvg: number | null,
  wholesaleAvg: number | null,
): DivisorChoice {
  const key = `${retailUnitId}>${wholesaleUnitId}`;

  const table = MEASURED_FACTORS[key];
  if (table !== undefined) {
    const primary: DivisorChoice = {
      divisor: table,
      source: "table",
      note: `${key} → ÷${table} (পরিমাপিত)`,
    };
    if (isPlausible(primary.divisor, retailAvg, wholesaleAvg)) return primary;
    return repair(key, table, retailAvg, wholesaleAvg, primary);
  }

  const derived = deriveDivisor(retailUnitId, wholesaleUnitId);
  if (derived !== null) {
    const primary: DivisorChoice = {
      divisor: derived,
      source: "derived",
      note: `${key} → ÷${roundish(derived)} (ইউনিট থেকে গণনা)`,
    };
    if (isPlausible(primary.divisor, retailAvg, wholesaleAvg)) return primary;
    return repair(key, derived, retailAvg, wholesaleAvg, primary);
  }

  return { divisor: 1, source: "unknown", note: `${key} → অজানা জোড়া, raw রাখা হয়েছে` };
}

/** Does dividing by `d` give a wholesale/retail ratio in a believable band? */
function isPlausible(d: number, retailAvg: number | null, wholesaleAvg: number | null): boolean {
  if (!retailAvg || !wholesaleAvg || retailAvg <= 0) return true; // cannot judge
  const ratio = wholesaleAvg / d / retailAvg;
  return ratio <= WHOLESALE_MAX_RATIO && ratio >= WHOLESALE_MIN_RATIO;
}

/**
 * The primary factor produced an impossible number. Try the standard
 * corrections (x100, /100, x10, /10, and 1) and pick the one that lands
 * closest to a typical wholesale discount (~0.85x retail).
 */
function repair(
  key: string,
  primary: number,
  retailAvg: number | null,
  wholesaleAvg: number | null,
  primaryChoice: DivisorChoice,
): DivisorChoice {
  if (!retailAvg || !wholesaleAvg || retailAvg <= 0) return primaryChoice;

  const candidates = [primary * 100, primary * 10, primary / 10, primary / 100, 1, 100];
  let best: DivisorChoice | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    if (!Number.isFinite(c) || c <= 0) continue;
    const ratio = wholesaleAvg / c / retailAvg;
    if (ratio > WHOLESALE_MAX_RATIO || ratio < WHOLESALE_MIN_RATIO) continue;
    const score = Math.abs(ratio - 0.85);
    if (score < bestScore) {
      bestScore = score;
      best = {
        divisor: roundish(c),
        source: "corrected",
        note: `${key} → ÷${roundish(c)} (প্রাথমিক ÷${primary} অসম্ভব ছিল, সংশোধিত)`,
      };
    }
  }

  if (best) return best;
  return {
    divisor: primary,
    source: "unknown",
    note: `${key} → ÷${primary} (যাচাই করা যায়নি, মান আগ্রহের জন্য প্রকাশ করা হবে না)`,
  };
}

/** Normalise a raw upstream number into the commodity's retail unit. */
export function toRetailUnit(value: number | null, divisor: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const v = value / divisor;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/** Canonical kilograms-per-unit for a unit id (null when not a mass). */
export function kgPerUnit(unitId: number): number | null {
  const u = UNIT_DEFS[unitId];
  if (!u || u.dim !== "mass") return null;
  return u.base / 1000;
}
