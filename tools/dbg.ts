import { resolve } from "../src/resolve.ts";
import { foldForCompare } from "../src/bn.ts";

const names = ["পেঁয়াজ (আলী)", "পেঁয়াজ (নতুন)", "পেঁয়াজ", "আলু (দেশীয়)", "চাল - আমন - সরু"];
const q = "পেঁয়াজ";
console.log("query norm:", JSON.stringify(foldForCompare(q)));
for (const n of names) {
  const r = resolve([{ id: 1, nameBn: n, nameEn: "x" }], q);
  console.log(" ", JSON.stringify(n), "-> norm", JSON.stringify(foldForCompare(n)), "match:", r.match ? "yes" : "no", "tied:", r.tied.length);
}

// Now the real list, as the resolver sees it.
const list = names.map((n, i) => ({ id: i + 1, nameBn: n, nameEn: "x" }));
const r2 = resolve(list, q);
console.log("\nlist resolve ->", JSON.stringify({ match: r2.match?.nameBn, tied: r2.tied.map((t) => t.nameBn), alt: r2.alternatives.length }));
