// Probe the resolver against the live catalogue, so a matching failure can
// be seen rather than guessed at.
import { resolve, findAllInText, candidatesFor } from "../src/resolve.ts";
import { foldForCompare, extractKeywords } from "../src/bn.ts";

const base = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";
const res = await fetch(`${base}/api/v1/commodities`);
const data = await res.json();
const list = data.commodities.map((c) => ({
  id: c.id,
  nameBn: c.nameBn,
  nameEn: c.nameEn,
}));

const query = process.argv[2] ?? "সয়াবিন তেল";
console.log(`query: ${JSON.stringify(query)}`);
console.log(`folded: ${JSON.stringify(foldForCompare(query))}`);
console.log(`keywords: ${JSON.stringify(extractKeywords(query))}`);

const r = resolve(list, query);
console.log(`resolve -> ${r.match ? `${r.match.id} ${r.match.nameBn}` : "no match"} (ambiguous=${r.ambiguous})`);

const cands = candidatesFor(list, extractKeywords(query));
console.log(`candidatesFor -> ${cands.length} hits: ${cands.map((c) => `${c.id}:${c.nameBn}`).join(" | ")}`);

const all = findAllInText(list, query);
console.log(`findAllInText -> ${all.all.length} hits: ${all.all.map((c) => `${c.id}:${c.nameBn}`).join(" | ")}`);

// Show the scoring for the soybean oil row specifically.
const target = list.find((c) => c.id === 818);
if (target) {
  console.log(`\ntarget 818: ${JSON.stringify(target.nameBn)}`);
  console.log(`folded 818: ${JSON.stringify(foldForCompare(target.nameBn))}`);
  const q = foldForCompare(query);
  const c = foldForCompare(target.nameBn);
  const tokens = q.split(/[\s\-_/(),]+/).filter((t) => t.length > 1);
  const words = c.split(/[\s\-_/(),]+/);
  console.log(`tokens: ${JSON.stringify(tokens)}`);
  console.log(`words : ${JSON.stringify(words)}`);
  console.log(`every token in words: ${tokens.every((t) => words.includes(t))}`);
}
