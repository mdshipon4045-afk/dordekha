/**
 * Bengali text normalisation for matching.
 *
 * The same Bengali word can be typed two ways:
 *   "পেঁয়াজ"  — ya + nukta (U+09AF U+09BC)  ← what most keyboards produce
 *   "পেঁয়াজ"  — precomposed ya (U+09DF)       ← what the government feed uses
 *
 * They look identical to a reader and to a search engine, but a plain
 * `String.includes` compares them as different strings. Since the upstream
 * data uses the precomposed form and users type the decomposed form, every
 * comparison in this codebase has to normalise both sides first — otherwise
 * the single most common search in the product silently returns nothing.
 *
 * The code points are written explicitly so that no editor or transfer step
 * can silently re-encode the literals and turn the fold into a no-op.
 */

const cp = (n: number): string => String.fromCodePoint(n);

const NUKTA = cp(0x09bc); // ়
const YA = cp(0x09af); // য
const DDA = cp(0x09a1); // ড
const DHA = cp(0x09a2); // ঢ
const PRE_YA = cp(0x09df); // য়
const PRE_RA = cp(0x09dc); // ড়
const PRE_RHA = cp(0x09dd); // ঢ়

/** Decomposed → precomposed. */
const FOLD: Array<[string, string]> = [
  [YA + NUKTA, PRE_YA],
  [DDA + NUKTA, PRE_RA],
  [DHA + NUKTA, PRE_RHA],
];

/** Zero-width characters carry no meaning for matching and break substring tests. */
const INVISIBLE = new RegExp("[\\u200B-\\u200D\\uFEFF]", "g");

/**
 * Fold a Bengali string into a canonical form so that two spellings of the
 * same word compare equal.
 */
export function normalizeBn(input: string | null | undefined): string {
  if (!input) return "";
  let out = input.replace(INVISIBLE, "");
  for (const [from, to] of FOLD) out = out.split(from).join(to);
  return out.replace(/\s+/g, " ").trim();
}

/** Bangla digits and their ASCII equivalents. */
const DIGIT_FOLD: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/** Convert Bangla digits to ASCII so numbers can be parsed. */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input) out += DIGIT_FOLD[ch] ?? ch;
  return out;
}

/** Case-insensitive comparison form for Bengali + Latin text. */
export function foldForCompare(input: string | null | undefined): string {
  return normalizeBn(input).toLowerCase();
}

/**
 * Does `haystack` contain `needle`, after both have been normalised?
 * An empty needle matches nothing (it would match everything).
 */
export function bnIncludes(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  const n = foldForCompare(needle);
  if (!n) return false;
  return foldForCompare(haystack).includes(n);
}

/**
 * Score how well `query` matches `candidate`.
 * Higher is better; 0 means no match at all.
 *
 * The scoring is deliberately simple and explainable:
 *   100  exact match
 *    90  candidate starts with the query
 *    70  every query word appears as a whole word of the candidate
 *    50  candidate contains the query
 *    30  every query token appears somewhere in the candidate
 */
export function matchScore(candidate: string | null | undefined, query: string | null | undefined): number {
  const c = foldForCompare(candidate);
  const q = foldForCompare(query);
  if (!c || !q) return 0;
  if (c === q) return 100;
  if (c.startsWith(q)) return 90;

  const tokens = q.split(/[\s\-_/(),]+/).filter((t) => t.length > 1);
  if (tokens.length > 0) {
    const words = c.split(/[\s\-_/(),]+/);
    if (tokens.every((t) => words.includes(t))) return 70;
    if (c.includes(q)) return 50;
    if (tokens.every((t) => c.includes(t))) return 30;
  }
  if (c.includes(q)) return 50;
  return 0;
}
