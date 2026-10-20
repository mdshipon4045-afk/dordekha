// Standalone: mirrors src/resolve.ts scoring to inspect ambiguity behaviour.
const cp = (n) => String.fromCodePoint(n);
const NUKTA = cp(0x09bc), YA = cp(0x09af), DDA = cp(0x09a1), DHA = cp(0x09a2);
const PRE_YA = cp(0x09df), PRE_RA = cp(0x09dc), PRE_RHA = cp(0x09dd);
const FOLD = [[YA + NUKTA, PRE_YA], [DDA + NUKTA, PRE_RA], [DHA + NUKTA, PRE_RHA]];
const INVISIBLE = new RegExp("[\\u200B-\\u200D\\uFEFF]", "g");

const normalizeBn = (input) => {
  if (!input) return "";
  let out = String(input).replace(INVISIBLE, "");
  for (const [f, t] of FOLD) out = out.split(f).join(t);
  return out.replace(/\s+/g, " ").trim();
};
const fold = (s) => normalizeBn(s).toLowerCase();

const scoreAgainst = (candidate, query) => {
  const c = fold(candidate), q = fold(query);
  if (!c || !q) return 0;
  if (c === q) return 100;
  if (q.includes(c)) return 95;
  if (c.includes(q)) return 90;
  return 0;
};

const names = ["পেঁয়াজ (আলী)", "পেঁয়াজ (নতুন)", "পেঁয়াজ", "আলু (দেশীয়)", "চাল - আমন - সরু"];
const q = "পেঁয়াজ";
console.log("query norm:", JSON.stringify(fold(q)));
for (const n of names) {
  console.log("  ", JSON.stringify(n), "norm:", JSON.stringify(fold(n)), "score:", scoreAgainst(n, q));
}
