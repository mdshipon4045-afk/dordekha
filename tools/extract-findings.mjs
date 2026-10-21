// Pull the numbered findings (তাৎ-২ …) out of the decoded audit report.
import { readFileSync, writeFileSync } from "node:fs";

const text = readFileSync("docs/audit-report-utf8.txt", "utf8");
const lines = text.split(/\r?\n/);

// The thorough reviewer's block starts at its own heading.
const startIdx = lines.findIndex((l) => l.includes("অ্যাডভারসরিয়াল") || l.includes("36"));
const start = startIdx >= 0 ? startIdx : 0;

const out = [];
for (let i = start; i < lines.length; i++) {
  const l = lines[i];
  if (/^#{1,3}\s/.test(l) || /^###?\s*তাৎ-/.test(l) || /^\*\*/.test(l) || /^[-*]\s/.test(l) || /^\|/.test(l)) {
    out.push(l);
  }
  if (out.length > 400) break;
}
writeFileSync("docs/audit-findings-extract.md", out.join("\n"), "utf8");
console.log(`extracted ${out.length} lines to docs/audit-findings-extract.md`);
