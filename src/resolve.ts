/**
 * Resolving a user's words to a commodity or a district.
 *
 * Two problems this solves:
 *
 * 1. "পেঁয়াজ" is ambiguous — the feed has "পেঁয়াজ - আলী", "পেঁয়াজ নতুন",
 *    "পেঁয়াজ (দেশীয়)" and more. A price service that silently picks one is
 *    worse than useless, so the resolver returns the best match *and* the
 *    alternatives, and the tie-break is deterministic (lowest id) so the
 *    REST API and the MCP tool always agree.
 *
 * 2. A claim like "পেঁয়াজ ৬০ টাকা ঢাকায়" is a sentence, not a name. The
 *    commodity has to be found *inside* the sentence, not matched against
 *    it as a whole.
 */

import { matchScore, foldForCompare } from "./bn";

export interface Resolvable {
  id: number;
  nameBn: string;
  nameEn: string;
}

export interface Resolution<T> {
  match: T | null;
  alternatives: T[];
  /** Every candidate that tied with the winner on score. */
  tied: T[];
  /** True when more than one candidate scored the same as the winner. */
  ambiguous: boolean;
}

/**
 * Score a candidate against a *query*.
 * A candidate whose name appears inside a longer sentence scores higher
 * than one that merely shares words with it.
 */
function scoreAgainst(candidate: string, query: string): number {
  const c = foldForCompare(candidate);
  const q = foldForCompare(query);
  if (!c || !q) return 0;
  if (c === q) return 100;

  const qWords = q.split(/[\s\-_/(),]+/).filter((w) => w.length > 1);
  const cWords = c.split(/[\s\-_/(),]+/).filter((w) => w.length > 1);

  // The candidate names everything the query names, and perhaps more:
  // "তৈল- সয়াবিন(খোলা)" for the query "সয়াবিন তেল". This is a *better*
  // match than a candidate the query merely contains, because the query
  // was the more specific of the two — the shopper said "soybean oil",
  // not "soybean".
  if (qWords.length > 1 && qWords.every((w) => cWords.includes(w))) return 96;

  // The query contains the candidate: "পেঁয়াজ ৬০ টাকা ঢাকায়" contains "পেঁয়াজ".
  if (q.includes(c)) return 95;
  // The candidate contains the query: "পেঁয়াজ" inside "পেঁয়াজ - আলী".
  if (c.includes(q)) return 90;
  return matchScore(candidate, query);
}

export function resolve<T extends Resolvable>(list: T[], query: string, limit = 5): Resolution<T> {
  const q = query.trim();
  const scored = list
    .map((item) => ({
      item,
      score: Math.max(scoreAgainst(item.nameBn, q), scoreAgainst(item.nameEn, q) - 5),
    }))
    .filter((s) => s.score >= 30)
    .sort((a, b) => (b.score - a.score) || (a.item.id - b.item.id));

  if (scored.length === 0) return { match: null, alternatives: [], tied: [], ambiguous: false };

  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score).map((s) => s.item);
  return {
    match: best.item,
    alternatives: tied.slice(1, limit),
    tied,
    ambiguous: tied.length > 1,
  };
}

/**
 * Choose between the candidates that matched one keyword.
 *
 * Ranking, in order:
 *   1. coverage — how much published data the candidate actually has
 *      (a variety that appears in no report is never the right answer);
 *   2. name length — the most generic name wins, so "পেঁয়াজ" beats
 *      "পেঁয়াজ (নতুন)" for the bare word "পেঁয়াজ";
 *   3. id — so the choice is deterministic.
 */
export function pickByCoverage<T extends Resolvable>(
  candidates: T[],
  coverage?: Map<number, number>,
): { match: T | null; alternatives: T[] } {
  if (candidates.length === 0) return { match: null, alternatives: [] };
  const ranked = [...candidates].sort((a, b) => {
    const ca = coverage?.get(a.id) ?? 0;
    const cb = coverage?.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    const la = a.nameBn.length;
    const lb = b.nameBn.length;
    if (la !== lb) return la - lb;
    return a.id - b.id;
  });
  return { match: ranked[0]!, alternatives: ranked.slice(1, 5) };
}

/**
 * Candidates whose name contains the keyword, together with a match score.
 * Both sides are folded, because the feed and the user's keyboard spell the
 * same Bengali word two different ways.
 *
 * The match must end on a word boundary. Without that rule "চাল" also
 * matches "চালকুমড়া" (corn) — a different product that merely starts with
 * the same letters.
 */
export function candidatesFor<T extends Resolvable>(list: T[], keywords: string[]): T[] {
  const out = new Map<number, T>();
  for (const k of keywords) {
    const key = foldForCompare(k);
    if (key.length < 2) continue;
    const words = key.split(/[^\p{L}\p{N}\p{M}]+/u).filter((w) => w.length >= 2);
    for (const item of list) {
      const bn = foldForCompare(item.nameBn);
      const en = foldForCompare(item.nameEn);
      if (!bn) continue;
      if (hasWord(bn, key) || hasWord(en, key)) out.set(item.id, item);
      // An English head word ("potato" in "Potato (Local)") also counts.
      const head = en.split(/[\s\-_/(),]+/).find((w) => w.length >= 3);
      if (head && key.includes(head)) out.set(item.id, item);
      // Every word of a multi-word query present in the candidate, in any
      // order: "সয়াবিন তেল" must meet "তৈল- সয়াবিন(খোলা)".
      if (words.length >= 2 && words.every((w) => hasWord(bn, w) || hasWord(en, w))) {
        out.set(item.id, item);
      }
    }
  }
  return [...out.values()];
}

/** Does `text` contain `needle` on a word boundary? */
function hasWord(text: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const after = text[at + needle.length];
    if (after === undefined || after === " " || after === "-" || after === "(" || after === "/" || after === ",") {
      return true;
    }
    from = at + 1;
  }
}

/**
 * Order tied candidates by how much data they actually have.
 *
 * "চাল" matches 27 rice varieties but only some appear in a given
 * district's report. Answering with one of the empty ones would be a
 * confident wrong answer, so coverage wins over id order.
 */
export function rankByCoverage<T extends Resolvable>(tied: T[], coverage: Map<number, number>): T[] {
  return [...tied].sort((a, b) => {
    const ca = coverage.get(a.id) ?? 0;
    const cb = coverage.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.id - b.id;
  });
}

/**
 * Every candidate mentioned inside a free-text claim, with a score.
 *
 * A claim names a product the way people speak, not the way the catalogue
 * is written. "পেঁয়াজ ৬০ টাকা ঢাকায়" means the local onion, but the
 * catalogue says "পেঁয়াজ - আলী" — and a matcher that requires the whole
 * name to appear will pick "পেঁয়াজ" (the new onion) instead, and then tell
 * the shopkeeper their price is wrong.
 *
 * So all the candidates are returned, ranked by how strongly the text
 * names them, and the caller can compare the claimed value against each
 * one instead of trusting a single silent pick.
 */
export function findAllInText<T extends Resolvable>(
  list: T[],
  text: string,
  limit = 8,
): { match: T | null; alternatives: T[]; all: T[] } {
  const hay = foldForCompare(text);
  const hayWords = new Set(hay.split(/[^\p{L}\p{N}\p{M}]+/u).filter((w) => w.length >= 2));

  const scored: { item: T; score: number }[] = [];
  for (const item of list) {
    const bn = foldForCompare(item.nameBn);
    const en = foldForCompare(item.nameEn);
    let score = 0;

    // The whole name is in the text.
    if (bn && hay.includes(bn)) score = Math.max(score, 100);
    if (en && hay.includes(en)) score = Math.max(score, 100);

    // Every word of the name is in the text, in any order.
    const nameWords = [...new Set([...bn.split(/[^\p{L}\p{N}\p{M}]+/u), ...en.split(/[^\p{L}\p{N}\p{M}]+/u)])].filter(
      (w) => w.length >= 2,
    );
    if (nameWords.length >= 2 && nameWords.every((w) => hayWords.has(w))) {
      score = Math.max(score, 80);
    }

    // The head word — the product noun — is in the text. "পেঁয়াজ" names
    // "পেঁয়াজ - আলী" as well as "পেঁয়াজ - আমদানি", and the text cannot
    // tell them apart. That is a weaker match, and it is ranked lower.
    const head = en.split(/[\s\-_/(),]+/).find((w) => w.length >= 4) ?? "";
    const bnHead = bn.split(/[\s\-_/(),]+/).find((w) => w.length >= 2) ?? "";
    if ((head && hayWords.has(head)) || (bnHead && hayWords.has(bnHead))) {
      score = Math.max(score, 60);
    }

    if (score > 0) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.item.id - b.item.id);
  if (scored.length === 0) return { match: null, alternatives: [], all: [] };

  return {
    match: scored[0]!.item,
    alternatives: scored.slice(1, limit).map((s) => s.item),
    all: scored.slice(0, limit).map((s) => s.item),
  };
}

/**
 * Extract the commodity and district mentioned in a free-text claim.
 *
 * Works by looking for each known name *inside* the claim, which is the
 * opposite direction from ordinary name matching and is what a sentence
 * needs.
 */
export function findInText<T extends Resolvable>(
  list: T[],
  text: string,
  limit = 5,
): { match: T | null; alternatives: T[] } {
  const res = findAllInText(list, text, limit + 1);
  return { match: res.match, alternatives: res.alternatives.slice(0, limit) };
}
