/**
 * URL slugs.
 *
 * The canonical URL form is ASCII (safe for APIs, MCP tool results and
 * machine consumers), while Bangla names remain the primary display text.
 * Bangla is transliterated rather than dropped so that "পেঁয়াজ" becomes
 * "penyaj" and not an empty string.
 *
 * Note: Bengali has no inherent schwa, so the transliteration is strict —
 * "দর" is "dr", not "dor". Where an English name exists it is preferred for
 * slugs, because it is what people actually search for.
 */

const TRANSLIT: Record<string, string> = {
  // independent vowels (স্বতন্ত্র স্বরবর্ণ)
  "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u",
  "ঋ": "ri", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
  // consonants
  "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
  "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "ny",
  "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n",
  "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
  "প": "p", "ফ": "ph", "ব": "b", "ভ": "bh", "ম": "m",
  "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh",
  "স": "s", "হ": "h",
  // vowel signs (কার)
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u",
  "ৃ": "ri", "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
  // signs
  "্": "", "ং": "n", "ঃ": "", "ঁ": "n",
  " ": "-", "-": "-", "(": "", ")": "", "‌": "", "‍": "",
  "/": "-", ",": "-", ".": "-", "–": "-", "—": "-",
};

/** Precomposed nukta letters, written as code points to avoid ambiguity. */
const PRECOMPOSED_RA = "ড়"; // U+09DC
const PRECOMPOSED_RHA = "ঢ়"; // U+09DD
const PRECOMPOSED_YA = "য়"; // U+09DF
const NUKTA = "়"; // U+09BC
const YA = "য"; // U+09AF
const DDA = "ড"; // U+09A1
const DHA = "ঢ"; // U+09A2

const BANGLA_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/**
 * Fold a nukta into the consonant it follows, so "য + nukta" becomes the
 * precomposed য় instead of transliterating as "j" followed by a stray mark.
 */
function foldNuktas(chars: string[]): string[] {
  const out: string[] = [];
  for (const ch of chars) {
    if (ch === NUKTA && out.length > 0) {
      const prev = out[out.length - 1]!;
      if (prev === YA) {
        out[out.length - 1] = PRECOMPOSED_YA;
        continue;
      }
      if (prev === DDA) {
        out[out.length - 1] = PRECOMPOSED_RA;
        continue;
      }
      if (prev === DHA) {
        out[out.length - 1] = PRECOMPOSED_RHA;
        continue;
      }
      continue; // stray nukta
    }
    out.push(ch);
  }
  return out;
}

/** Transliterate Bangla (and any other non-ASCII) into ASCII. */
export function transliterate(input: string): string {
  let out = "";
  for (const ch of foldNuktas([...input])) {
    const low = ch.toLowerCase();
    if (BANGLA_DIGITS[ch]) {
      out += BANGLA_DIGITS[ch];
      continue;
    }
    if (ch.charCodeAt(0) < 128) {
      out += ch;
      continue;
    }
    if (ch === PRECOMPOSED_RA) {
      out += "r";
      continue;
    }
    if (ch === PRECOMPOSED_RHA) {
      out += "rh";
      continue;
    }
    if (ch === PRECOMPOSED_YA) {
      out += "y";
      continue;
    }
    out += TRANSLIT[ch] ?? TRANSLIT[low] ?? "";
  }
  return out;
}

/** Lowercase, ASCII-safe, hyphen-separated slug. */
export function slugify(input: string): string {
  return transliterate(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Build a slug from a Bangla name with an English fallback, so two
 * commodities with the same English prefix still get distinct URLs.
 */
export function commoditySlug(bn: string, en: string | null | undefined, id: number): string {
  const base = slugify(en && en.trim() ? en : bn);
  const bnPart = slugify(bn);
  if (!base) return `c${id}`;
  // Append the id when the English name does not distinguish the commodity.
  if (bnPart && bnPart !== base && !base.startsWith(bnPart.slice(0, 6))) {
    return `${base}-${id}`;
  }
  return base;
}

export function districtSlug(bn: string, en: string | null | undefined, id: number): string {
  const base = slugify(en && en.trim() ? en : bn);
  return base || `d${id}`;
}
