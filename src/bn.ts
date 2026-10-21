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

/**
 * Words that carry no meaning in a price question.
 *
 * "আজ পেঁয়াজের দাম কত" carries one piece of information — পেঁয়াজ — and
 * everything else is question scaffolding. Stripping it is what lets a
 * commodity be found inside a sentence rather than matched against it.
 */
const QUESTION_WORDS = new Set([
  "আজ", "আজকের", "আজকি", "এখন", "এখনকার", "কত", "কি", "কী",
  "দাম", "দর", "বাজার", "বাজারদর", "মূল্য", "টাকা", "টাকার", "হয়", "হলো",
  "করে", "করার", "কার", "দেয়", "দেওয়া", "দিয়েছে", "দিয়ে", "দিলে", "থাকে",
  "কোন", "কোনো", "কোনটা", "খুঁজুন", "খুঁজে", "আছে", "নেই", "জানতে", "জানান",
  "আমি", "আমার", "আপনি", "আপনার", "আমরা", "আমাদের", "আপনাদের", "ওরা", "তারা", "তার",
  "এবং", "ও", "বা", "মধ্যে", "থেকে", "উপরে", "নিচে", "প্রতি", "হিসেবে",
  "এর", "র", "টি", "টা", "এক", "আর", "সেই", "এই", "যে", "তা", "তারা",
]);

/**
 * Pull the meaningful nouns out of a price question.
 *
 * Returns the tokens that could name a commodity or a district, in the
 * order they appeared.
 */
export function extractKeywords(text: string | null | undefined): string[] {
  if (!text) return [];
  const folded = foldForCompare(text);
  const raw = String(text).split(/\s+/);
  const out: string[] = [];

  for (const word of raw) {
    const w = foldForCompare(word).replace(/[?!,।\.]/g, "");
    if (!w) continue;
    if (QUESTION_WORDS.has(w)) continue;
    // A bare number is a price, not a name. "৬০ কেজি" must not pull in a
    // commodity that happens to have "60" in its own name.
    if (/^[\d০-৯.,]+$/.test(w)) continue;
    // A possessive suffix ("পেঁয়াজের", "আলুর") should still match the bare
    // noun, so the stem is what gets kept — not the suffixed form.
    let stem = w;
    if (w.endsWith("ের") && w.length > 3) stem = w.slice(0, -2);
    else if (w.endsWith("র") && w.length > 3) stem = w.slice(0, -1);
    if (stem.length >= 2 && !QUESTION_WORDS.has(stem)) out.push(stem);
  }
  return [...new Set(out)];
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
