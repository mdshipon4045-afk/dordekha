/**
 * Point the search engines at the pages that exist.
 *
 * A site with no external links is not found by being crawled — it is
 * found by being pointed at. This reads the sitemaps and sends the URLs
 * to the engines that accept IndexNow. Google does not accept it, so for
 * Google the path is links and Search Console.
 *
 *   node tools/notify-indexnow.mjs
 */

import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "https://dordekha.pages.dev";
const ENDPOINT = "https://api.indexnow.org/indexnow";

function key() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY;
  const vars = readFileSync(".dev.vars", "utf8");
  const m = vars.match(/INDEXNOW_KEY\s*=\s*"?([A-Za-z0-9-]+)"?/);
  if (!m) throw new Error("INDEXNOW_KEY is not set");
  return m[1];
}

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const index = await text(`${BASE}/sitemap.xml`);
const parts = locs(index);
console.log(`sitemap parts: ${parts.length}`);

const urls = [];
for (const part of parts) {
  const found = locs(await text(part));
  console.log(`  ${part.replace(BASE, "")} → ${found.length}`);
  urls.push(...found);
}

// The index itself and the pages that carry the business.
urls.push(`${BASE}/`, `${BASE}/api`, `${BASE}/dataset`, `${BASE}/pricing`, `${BASE}/methodology`);

const unique = [...new Set(urls)];
console.log(`\nsubmitting ${unique.length} URLs`);

const k = key();
const host = new URL(BASE).host;
let sent = 0;
for (let i = 0; i < unique.length; i += 10000) {
  const batch = unique.slice(i, i + 10000);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: k, urlList: batch }),
  });
  const text = await res.text();
  console.log(`  batch ${i / 10000 + 1}: ${batch.length} URLs → HTTP ${res.status} ${text.trim()}`);
  sent += res.status === 200 || res.status === 202 ? batch.length : 0;
}
console.log(`\naccepted: ${sent} of ${unique.length}`);
