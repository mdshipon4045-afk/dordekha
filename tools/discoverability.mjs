/**
 * How discoverable is the site, to a crawler that has never seen it?
 *
 * Measures the things that decide whether a new URL is found at all:
 * the link graph from the home page, the depth of a fact page, and the
 * search-facing metadata of the pages that carry the business.
 */

const BASE = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, text: await res.text() };
}

function links(html) {
  return [...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]);
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+name="${name}"[^>]*content="([^"]*)"`, "i");
  return (html.match(re) ?? [])[1] ?? null;
}

function title(html) {
  return (html.match(/<title>([^<]*)<\/title>/i) ?? [])[1] ?? null;
}

console.log("=== the home page ===");
const home = await get("/");
console.log("status", home.status, "| title:", title(home.text));
console.log("description:", meta(home.text, "description"));
const homeLinks = [...new Set(links(home.text))];
console.log("unique internal links:", homeLinks.length);
const byFirst = new Map();
for (const l of homeLinks) {
  const k = "/" + l.split("/")[1];
  byFirst.set(k, (byFirst.get(k) ?? 0) + 1);
}
console.log([...byFirst.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join("  "));

console.log("\n=== /price (the commodity index) ===");
const price = await get("/price");
const priceLinks = [...new Set(links(price.text))];
console.log("status", price.status, "| internal links:", priceLinks.length);
console.log("sample:", priceLinks.slice(0, 6).join("  "));

console.log("\n=== how deep is a fact page? ===");
let depth = 0;
let current = ["/"];
const seen = new Set();
while (depth < 4) {
  const next = [];
  for (const p of current.slice(0, 4)) {
    if (seen.has(p)) continue;
    seen.add(p);
    const page = await get(p);
    for (const l of links(page.text)) {
      if (/^\/price\/[^/]+\/[^/]+\/\d{4}-\d{2}-\d{2}$/.test(l)) {
        console.log(`a fact page is ${depth + 1} click(s) from the home page: ${l}`);
        next.length = 0;
        break;
      }
      if (!seen.has(l)) next.push(l);
    }
  }
  if (!next.length) break;
  current = next;
  depth++;
  if (depth > 3) break;
}

console.log("\n=== the pages that carry the business ===");
for (const path of ["/api", "/dataset", "/pricing", "/methodology"]) {
  const page = await get(path);
  console.log(`\n${path}  (${page.status})`);
  console.log("  title:      ", title(page.text));
  console.log("  description:", meta(page.text, "description"));
  const kw = meta(page.text, "keywords");
  if (kw) console.log("  keywords:   ", kw);
}
