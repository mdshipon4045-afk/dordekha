// The home page must show the same movers board whether it is computed
// from the database or from the cache.
const base = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";
const t = await (await fetch(base + "/")).text();

const section = t.split("movers")[1] ?? "";
const rows = [...t.matchAll(/<div class="mv-name">([^<]*)<\/div>[\s\S]{0,400}?mover-value[^>]*>([^<]*)</g)];
console.log(`home page: ${t.length} bytes`);
console.log(`mover rows found: ${rows.length}`);
for (const m of rows.slice(0, 8)) console.log(`  ${m[1]} → ${m[2]}`);

// The ledger sheet, too.
const ledger = [...t.matchAll(/<td class="c-item">([^<]*)<\/td>/g)].map((m) => m[1].trim());
console.log(`\nledger rows: ${ledger.length}`);
console.log(ledger.slice(0, 10).map((x) => "  " + x).join("\n"));

const stats = [...t.matchAll(/<div class="n">([^<]*)<small>([^<]*)<\/small><\/div><div class="l">([^<]*)<\/div>/g)];
console.log(`\nstatistics strip:`);
for (const s of stats) console.log(`  ${s[1]}${s[2]} ${s[3]}`);
