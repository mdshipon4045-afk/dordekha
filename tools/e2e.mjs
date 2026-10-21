// End-to-end check of every public surface against a running dev server.
const BASE = process.env.BASE ?? "http://localhost:8787";
const q = (s) => encodeURIComponent(s);

// Bengali nukta can be encoded two ways; the feed and the test string may
// differ, so comparisons fold to the precomposed form first.
const cp = (n) => String.fromCodePoint(n);
const normBn = (s) => String(s).split(cp(0x09af) + cp(0x09bc)).join(cp(0x09df));

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, type: res.headers.get("content-type") ?? "", text, res };
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, type: res.headers.get("content-type") ?? "", text };
}

// ── health ──────────────────────────────────────────────────────────────────
{
  const r = await get("/health");
  let ok = false;
  try {
    const j = JSON.parse(r.text);
    ok = r.status === 200 && j.ok === true && j.rows > 0;
    check("/health reports ok with rows", ok, `status=${r.status} rows=${j.rows} latest=${j.latest_date}`);
    check("/health does not leak pipeline internals", j.lastRun === undefined, JSON.stringify(j.lastRun));
  } catch {
    check("/health reports ok with rows", false, r.text.slice(0, 120));
  }
}

// ── pages ───────────────────────────────────────────────────────────────────
{
  const r = await get("/");
  check("home renders", r.status === 200 && r.type.includes("text/html") && r.text.includes("দরদেখা"), `status=${r.status}`);
  check("home carries a canonical link", r.text.includes('rel="canonical"'));
  check("home carries JSON-LD Dataset", r.text.includes('"@type":"Dataset"'));
  check("home carries og:locale bn_BD", r.text.includes('og:locale" content="bn_BD"'));
}
{
  const r = await get("/price");
  check("price index renders", r.status === 200 && r.text.includes("পণ্যতালিকা"), `status=${r.status}`);
}
{
  const r = await get("/dataset");
  check("dataset page renders", r.status === 200 && r.text.includes("ডেটাসেট"), `status=${r.status}`);
}
{
  const r = await get("/methodology");
  check("methodology page renders", r.status === 200 && r.text.includes("পদ্ধতি"), `status=${r.status}`);
}
{
  const r = await get("/licence");
  check("licence page renders", r.status === 200 && r.text.includes("লাইসেন্স"), `status=${r.status}`);
}
{
  const r = await get("/api");
  check("api doc page renders", r.status === 200 && r.text.includes("MCP"), `status=${r.status}`);
}

// ── content negotiation ─────────────────────────────────────────────────────
{
  const r = await get("/", { Accept: "text/markdown" });
  check("home negotiates markdown", r.status === 200 && r.type.includes("text/markdown"), r.type);
  check("markdown has no HTML tags", !r.text.includes("<html"));
}
{
  const r = await get("/", { Accept: "application/json" });
  check("home negotiates json", r.status === 200 && r.type.includes("application/json"), r.type);
}
{
  const r = await get("/");
  check("responses send Vary: Accept", (r.res.headers.get("vary") ?? "").includes("Accept"), r.res.headers.get("vary") ?? "none");
}

// ── robots / llms / sitemap ────────────────────────────────────────────────
{
  const r = await get("/robots.txt");
  const t = r.text;
  check("robots allows OAI-SearchBot", t.includes("User-agent: OAI-SearchBot") && t.includes("Allow: /"));
  check("robots allows Claude-SearchBot", t.includes("User-agent: Claude-SearchBot"));
  check("robots allows PerplexityBot", t.includes("User-agent: PerplexityBot"));
  check("robots blocks GPTBot", t.includes("User-agent: GPTBot") && t.includes("Disallow: /"));
  check("robots blocks Google-Extended", t.includes("User-agent: Google-Extended"));
  check("robots points at the sitemap", t.includes("Sitemap:"));
}
{
  const r = await get("/llms.txt");
  check("llms.txt serves", r.status === 200 && r.text.includes("MCP server"), `status=${r.status}`);
}
{
  const r = await get("/sitemap.xml");
  check("sitemap serves", r.status === 200 && r.text.includes("<urlset"), `status=${r.status}`);
}

// ── API ─────────────────────────────────────────────────────────────────────
{
  const r = await get("/api/v1/latest?district=47");
  const j = JSON.parse(r.text);
  check("/api/v1/latest returns prices", r.status === 200 && Array.isArray(j.prices) && j.prices.length > 0, `count=${j.prices?.length}`);
}
{
  const r = await get(`/api/v1/price?commodity=${q("পেঁয়াজ")}&district=${q("ঢাকা")}`);
  const j = JSON.parse(r.text);
  check("/api/v1/price returns a fact", r.status === 200 && j.retail?.avg > 0, `retail=${j.retail?.avg} wholesale=${j.wholesale?.avg}`);
  check("fact carries a canonical url", typeof j.canonical_url === "string" && j.canonical_url.includes("/price/"));
}
{
  const r = await get("/api/v1/series.csv?commodity=602&district=47");
  check("/api/v1/series.csv serves CSV", r.status === 200 && r.type.includes("text/csv") && r.text.includes("price_date,"), `status=${r.status}`);
}
{
  const r = await get("/api/v1/districts");
  const j = JSON.parse(r.text);
  check("/api/v1/districts lists 64", j.count === 64, `count=${j.count}`);
}
{
  const r = await get("/api/v1/commodities");
  const j = JSON.parse(r.text);
  check("/api/v1/commodities lists 447", j.count === 447, `count=${j.count}`);
}

// ── per-fact permalink ─────────────────────────────────────────────────────
{
  const fact = await get(`/api/v1/price?commodity=${q("পেঁয়াজ")}&district=${q("ঢাকা")}`);
  const j = JSON.parse(fact.text);
  const url = j.canonical_url;
  const path = url.replace(BASE, "");
  const r = await get(path);
  check("per-fact permalink renders", r.status === 200 && normBn(r.text).includes(normBn("পেঁয়াজ")), `status=${r.status} path=${path}`);
  check("per-fact page has JSON-LD", r.text.includes('"@type":"Dataset"'));
  const m = await get(`${path}.md`);
  check("per-fact .md variant works", m.status === 200 && m.type.includes("text/markdown"), `${m.type} status=${m.status}`);
  const j2 = await get(`${path}.json`);
  check("per-fact .json variant works", j2.status === 200 && JSON.parse(j2.text).canonical_url === url, `status=${j2.status}`);
  const m2 = await get(`${path}`, { Accept: "text/markdown" });
  check("per-fact honours Accept: text/markdown", m2.status === 200 && m2.type.includes("text/markdown"), m2.type);
  const j3 = await get(`${path}`, { Accept: "application/json" });
  check("per-fact honours Accept: application/json", j3.status === 200 && j3.type.includes("application/json"), j3.type);
  check("per-fact page names the commodity", normBn(r.text).includes(normBn("পেঁয়াজ")));}

// ── a requested date must never come back carrying another day's figures ──
{
  const hist = await get("/api/v1/series.csv?commodity=833&district=47");
  const dates = hist.text.split("\n").slice(1).map((l) => l.split(",")[0]).filter(Boolean);
  const have = dates[dates.length - 1];
  const missing = "2020-01-01";

  const r1 = await get(`/price/onion-new-833/dhaka/${have}.json`);
  const j1 = JSON.parse(r1.text);
  check(
    "a date we hold returns that date",
    r1.status === 200 && j1.price_date === have,
    `asked ${have} -> ${j1.price_date}`,
  );

  const r2 = await get(`/price/onion-new-833/dhaka/${missing}.json`);
  const body2 = r2.text;
  check(
    "a date we do not hold is refused, not substituted",
    r2.status === 404 && !body2.includes('"price_date"'),
    `status=${r2.status} body starts: ${body2.slice(0, 60)}`,
  );

  const r3 = await get(`/price/onion-new-833/dhaka/${missing}`);
  check(
    "the missing date gets an explanatory page",
    r3.status === 404 && r3.text.includes("তারিখে কোনো তথ্য নেই"),
    `status=${r3.status}`,
  );
}

// ── units must be the same on both sides of the comparison ──
{
  const r = await get("/price/onion-new-833/dhaka/2026-10-19.json");
  const j = JSON.parse(r.text);
  check(
    "wholesale is published in the retail unit",
    j.prices.wholesale?.unit_bn === j.prices.retail?.unit_bn,
    `retail=${j.prices.retail?.unit_bn} wholesale=${j.prices.wholesale?.unit_bn}`,
  );
}

// ── verify ──────────────────────────────────────────────────────────────────
{
  const r = await get(`/verify?claim=${q("পেঁয়াজ ৬০ টাকা ঢাকায়")}`);
  check("/verify renders a verdict", r.status === 200 && (r.text.includes("মিলেছে") || r.text.includes("মিলেনি")), `status=${r.status}`);
}

// ── MCP ─────────────────────────────────────────────────────────────────────
{
  const r = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "server/discover" }, { "MCP-Protocol-Version": "2026-07-28" });
  const j = JSON.parse(r.text);
  check("mcp server/discover works", r.status === 200 && j.result?.supportedVersions?.includes("2026-07-28"), JSON.stringify(j.result?.supportedVersions));
  check("mcp discover advertises tools", Boolean(j.result?.capabilities?.tools));
  check("mcp discover carries serverInfo", Boolean(j.result?._meta?.["io.modelcontextprotocol/serverInfo"]?.name));
}
{
  const r = await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const j = JSON.parse(r.text);
  const names = (j.result?.tools ?? []).map((t) => t.name);
  check(
    "mcp tools/list exposes all four tools",
    ["get_market_price", "compare_districts", "get_price_trend", "verify_claim"].every((n) => names.includes(n)),
    names.join(", "),
  );
  check("mcp tools carry titles and annotations", (j.result?.tools ?? []).every((t) => t.title && t.annotations?.readOnlyHint === true));
}
{
  const r = await post("/mcp", {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "get_market_price", arguments: { commodity: "পেঁয়াজ", district: "ঢাকা" } },
  });
  const j = JSON.parse(r.text);
  const sc = j.result?.structuredContent;
  const errText = j.result?.content?.[0]?.text ?? "";
  check("mcp get_market_price returns a price", Boolean(sc?.retail?.avg), `retail=${sc?.retail?.avg} ${errText.slice(0, 90)}`);
  check("mcp result carries a citable url", typeof sc?.url === "string" && sc.url.includes("/price/"), sc?.url ?? "none");
  check("mcp result carries a title", typeof sc?.title === "string" && sc.title.length > 0, sc?.title ?? "none");
}
{
  // "চাল" matches 27 rice varieties, so this is a genuinely ambiguous query
  // and the tool has to say so rather than silently pick one.
  const r = await post("/mcp", {
    jsonrpc: "2.0", id: 31, method: "tools/call",
    params: { name: "get_market_price", arguments: { commodity: "চাল", district: "ঢাকা" } },
  });
  const j = JSON.parse(r.text);
  const sc = j.result?.structuredContent;
  check("mcp flags an ambiguous commodity", sc?.ambiguous === true, `ambiguous=${sc?.ambiguous}`);
  check("mcp lists the alternatives", (sc?.alternatives?.commodities?.length ?? 0) > 0, JSON.stringify(sc?.alternatives?.commodities ?? []));
  check("mcp picks the variety that actually has data", Boolean(sc?.retail?.avg), `retail=${sc?.retail?.avg}`);
}
{
  const r = await post("/mcp", {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "compare_districts", arguments: { commodity: "চাল" } },
  });
  const j = JSON.parse(r.text);
  const sc = j.result?.structuredContent;
  const errText = j.result?.content?.[0]?.text ?? "";
  check("mcp compare_districts works", Boolean(sc?.cheapest?.district) && Boolean(sc?.dearest?.district), `cheapest=${sc?.cheapest?.district} dearest=${sc?.dearest?.district} ${errText.slice(0, 90)}`);
  check("mcp compare_districts carries a url", typeof sc?.url === "string");
}
{
  const r = await post("/mcp", {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "verify_claim", arguments: { claim: "পেঁয়াজ ৬০ টাকা ঢাকায়" } },
  });
  const j = JSON.parse(r.text);
  const sc = j.result?.structuredContent;
  const errText = j.result?.content?.[0]?.text ?? "";
  check("mcp verify_claim returns a verdict", typeof sc?.verdict === "string", `${sc?.verdict ?? "none"} ${errText.slice(0, 90)}`);
  check("mcp verify_claim states the actual price", Boolean(sc?.actual?.avg), `actual=${sc?.actual?.avg}`);
}
{
  const r = await post("/mcp", { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_price_trend", arguments: { commodity: "চাল", district: "ঢাকা" } } });
  const j = JSON.parse(r.text);
  const errText = j.result?.content?.[0]?.text ?? "";
  check("mcp get_price_trend works", Array.isArray(j.result?.structuredContent?.points) && j.result.structuredContent.points.length > 0, `points=${j.result?.structuredContent?.points?.length} ${errText.slice(0, 90)}`);
}
{
  const r = await post("/mcp", { jsonrpc: "2.0", id: 7, method: "nope/nope" });
  const j = JSON.parse(r.text);
  check("mcp rejects unknown methods", j.error?.code === -32601, `code=${j.error?.code}`);
}

// ── summary ─────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("\nFAILURES:");
  for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`);
  process.exitCode = 1;
}
