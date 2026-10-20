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
  const hay = foldForCompare(text);
  const hits = list
    .filter((item) => {
      const bn = foldForCompare(item.nameBn);
      const en = foldForCompare(item.nameEn);
      if (bn.length >= 2 && hay.includes(bn)) return true;
      // The first word of a multi-word English name is often enough
      // ("Rice - Aman-Fine" → "rice"), but only if the full name is absent.
      if (en.length >= 4) {
        const head = en.split(/[\s\-_/(),]+/).find((w) => w.length >= 4) ?? "";
        if (head && hay.includes(head) && !hay.includes(en)) return true;
      }
      return false;
    })
    .sort((a, b) => a.id - b.id);

  if (hits.length === 0) return { match: null, alternatives: [] };
  return { match: hits[0]!, alternatives: hits.slice(1, limit) };
}
