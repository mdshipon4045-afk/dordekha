// Read the multi-AI audit report, split it by reviewer, and pull out the
// findings that are NOT just "the site returned 500 during the outage".
import { readFileSync, writeFileSync } from "node:fs";

const src = "docs/Audit-Prompts report by multipul ai.txt";
let raw = readFileSync(src);
if (raw[0] === 0xff && raw[1] === 0xfe) raw = raw.subarray(2);
let text = raw.toString("utf16le");
if (!/[ঀ-৿]/.test(text) && /[ঀ-৿]/.test(raw.toString("utf8"))) {
  text = readFileSync(src, "utf8");
}
writeFileSync("docs/audit-report-utf8.txt", text, "utf8");

const lines = text.split(/\r?\n/);
console.log(`decoded: ${lines.length} lines, ${text.length} chars`);

// The report boundaries look like a run of separator characters.
const isSeparator = (l) => /^[\s.…\-=_*#]{3,}$/.test(l) && l.length >= 3;

const blocks = [];
let current = { start: 0, lines: [] };
for (let i = 0; i < lines.length; i++) {
  if (isSeparator(lines[i]) && current.lines.length > 6) {
    blocks.push(current);
    current = { start: i, lines: [] };
    continue;
  }
  current.lines.push(lines[i]);
}
if (current.lines.length > 6) blocks.push(current);

console.log(`\nreviewer blocks detected: ${blocks.length}`);
for (const b of blocks) {
  const head = b.lines.find((l) => l.trim().length > 0) ?? "";
  console.log(`  - ${head.slice(0, 110).replace(/\s+/g, " ")}`);
}

// Findings that mention a concrete URL or behaviour, excluding the blanket
// "everything 500" noise, which was the outage and is already fixed.
console.log("\n\n=== distinct findings across reviewers ===\n");
const OUTAGE = /500|D1_ERROR|read limit|free tier|exceeded|down|ডাউন|বন্ধ|503/gi;

const byFinding = new Map();
for (const b of blocks) {
  const seen = new Set();
  for (const l of b.lines) {
    const t = l.trim();
    if (!t || t.length < 12) continue;
    if (!/^[-*•|]|\|\s*\w+\s*\|/.test(t) && !/https?:\/\//.test(t)) continue;
    // normalise: drop the numbers, keep the shape of the claim
    const key = t
      .replace(/\d+/g, "#")
      .replace(OUTAGE, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 130);
    if (key.length < 15) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byFinding.has(key)) byFinding.set(key, { count: 0, sample: t, reviewers: new Set() });
    byFinding.get(key).count++;
    byFinding.get(key).reviewers.add(b.start);
  }
}

const sorted = [...byFinding.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [key, v] of sorted.slice(0, 60)) {
  console.log(`[${v.count}x] ${v.sample.slice(0, 190)}`);
}
console.log(`\n\ntotal distinct normalised findings: ${sorted.length}`);
