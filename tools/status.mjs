// One-shot status check for the live deployment.
//   node tools/status.mjs
const BASE = process.env.BASE ?? "https://dordekha.pages.dev";
const TOKEN = process.env.ADMIN_TOKEN ?? "";

async function j(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

const out = [];
function line(label, value, good) {
  const mark = good === undefined ? "·" : good ? "OK" : "!!";
  console.log(`${mark}  ${label.padEnd(34)} ${value}`);
  out.push({ label, value, good });
}

console.log(`\nদরদেখা — লাইভ স্ট্যাটাস  (${BASE})\n`);

const h = await j("/health");
line("health", `status=${h.status} ok=${h.body.ok} latest=${h.body.latest_date} rows=${h.body.rows}`, h.status === 200);

const d = await j("/api/v1/districts");
line("districts", d.body.count, d.body.count === 64);
const c = await j("/api/v1/commodities");
line("commodities", c.body.count, c.body.count === 447);

const t = await j("/internal/telegram/check", { headers: { "X-Admin-Token": TOKEN } });
line(
  "telegram channel",
  t.body.ok ? "bot can post" : `NOT READY — ${t.body.error ?? "unknown"}`,
  t.body.ok === true,
);

const m = await j("/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2026-07-28" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const tools = (m.body?.result?.tools ?? []).map((x) => x.name);
line("mcp tools", tools.join(", "), tools.length === 4);

const p = await j(
  `/api/v1/price?commodity=${encodeURIComponent("পেঁয়াজ")}&district=${encodeURIComponent("ঢাকা")}`,
);
line(
  "live fact",
  p.body.retail
    ? `${p.body.commodity?.name_bn ?? "?"} ${p.body.district?.name_bn ?? "?"} ${p.body.price_date}: retail ${p.body.retail.avg}, wholesale ${p.body.wholesale?.avg}`
    : p.body.error,
  Boolean(p.body.retail),
);

const r = await j("/robots.txt");
const rOk = r.body.includes("User-agent: OAI-SearchBot") && r.body.includes("User-agent: GPTBot");
line("robots split", rOk ? "search allowed, training blocked" : "WRONG", rOk);

const bad = out.filter((x) => x.good === false);
console.log(`\n${out.length - bad.length}/${out.length} checks healthy`);
if (bad.length) {
  console.log("\nNeeds attention:");
  for (const b of bad) console.log(`  - ${b.label}: ${b.value}`);
  process.exitCode = 1;
}
console.log();
