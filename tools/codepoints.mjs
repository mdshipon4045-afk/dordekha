// Print the code points of the Bengali literals that matter, so a
// normalisation difference is visible instead of mysterious.
import { readFileSync } from "node:fs";

const cp = (s) => [...s].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");

function show(label, text) {
  console.log(`${label}: ${JSON.stringify(text)}  ${cp(text)}`);
}

const src = readFileSync("src/bn.ts", "utf8");
const block = src.match(/const WORD_ALIASES[\s\S]*?\n\];/)[0];
console.log("--- bn.ts alias block ---");
for (const line of block.split("\n")) {
  const lits = line.match(/"[^"]*"/g) ?? [];
  for (const l of lits) {
    const t = l.slice(1, -1);
    if (/[\u0980-\u09FF]/.test(t)) show("  alias", t);
  }
}

const test = readFileSync("test/audit-fix.test.ts", "utf8");
console.log("--- test file literals ---");
for (const l of test.match(/"[^"]*"/g) ?? []) {
  const t = l.slice(1, -1);
  if (/[\u0980-\u09FF]/.test(t) && /পেঁয়াজ|সয়াবিন|তেল|তৈল/.test(t)) show("  test ", t);
}

console.log("--- what the upstream feed uses ---");
const feed = readFileSync("tools/build-snapshot.mjs", "utf8");
console.log("  (feed text comes from the export at runtime)");
