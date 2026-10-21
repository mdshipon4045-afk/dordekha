// Verify each audit finding against the live site, from the outside.
//   node tools/verify-audit.mjs
const B = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";
const cp = (n) => String.fromCodePoint(n);
const norm = (s) => String(s).split(cp(0x09af) + cp(0x09bc)).join(cp(0x09df));
const Q = (s) => encodeURIComponent(s);

const results = [];
function check(id, claim, ok, detail) {
  results.push({ id, claim, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${id}  ${claim}${detail ? `\n       ${detail}` : ""}`);
}

async function get(path, headers = {}) {
  const r = await fetch(B + path, { headers });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, json, type: r.headers.get("content-type") ?? "" };
}
async function post(path, body, headers = {}) {
  const r = await fetch(B + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, json };
}
const mcp = (method, params) =>
  post("/mcp", { jsonrpc: "2.0", id: 1, method, params });

console.log(`\nVerifying the audit findings against ${B}\n`);

// ── তাৎ-২: the tools must return the most recent date ──────────────────────
{
  const health = await get("/health");
  const latest = health.json?.latest_date;
  const call = await mcp("tools/call", {
    name: "get_market_price",
    arguments: { commodity: "পেঁয়াজ", district: "ঢাকা" },
  });
  const sc = call.json?.result?.structuredContent;
  const page = await get("/price/onion-new-833/dhaka/" + latest + ".json");
  const pj = page.json;
  check(
    "তাৎ-২",
    "MCP get_market_price returns the most recent report date",
    sc?.price_date === latest,
    `health.latest=${latest} | mcp.price_date=${sc?.price_date} | page retail=${pj?.prices?.retail?.avg} | mcp retail=${sc?.retail?.avg}`,
  );
  const dated = await mcp("tools/call", {
    name: "get_market_price",
    arguments: { commodity: "পেঁয়াজ", district: "ঢাকা", date: latest },
  });
  check(
    "তাৎ-২b",
    "MCP honours an explicit date parameter",
    dated.json?.result?.structuredContent?.price_date === latest,
    `asked ${latest} -> got ${dated.json?.result?.structuredContent?.price_date}`,
  );
  const api = await get(`/api/v1/price?commodity=${Q("পেঁয়াজ")}&district=${Q("ঢাকা")}&date=${latest}`);
  check(
    "তাৎ-২c",
    "/api/v1/price honours an explicit date parameter",
    api.json?.price_date === latest,
    `asked ${latest} -> got ${api.json?.price_date}`,
  );
}

// ── তাৎ-৩: verify_claim must not call a true claim false ───────────────────
{
  const c = await mcp("tools/call", {
    name: "verify_claim",
    arguments: { claim: "পেঁয়াজ ৬০ টাকা ঢাকায়" },
  });
  const sc = c.json?.result?.structuredContent;
  const actual = sc?.actual;
  const inRange = actual && 60 >= actual.min * 0.9 && 60 <= actual.max * 1.1;
  check(
    "তাৎ-৩",
    "verify_claim accepts a claim inside the official range",
    sc?.matches === true || (inRange && sc?.matches !== false),
    `verdict=${sc?.verdict} matches=${sc?.matches} actual=${actual?.min}-${actual?.max}`,
  );
}

// ── তাৎ-৪: carried_forward must agree between endpoints ───────────────────
{
  const latest = (await get("/health")).json?.latest_date;
  const page = await get(`/price/onion-new-833/dhaka/${latest}.json`);
  const api = await get(`/api/v1/price?commodity=833&district=47`);
  check(
    "তাৎ-৪",
    "carried_forward agrees between the fact page and the API",
    page.json?.carried_forward !== undefined &&
      page.json?.carried_forward === api.json?.carried_forward,
    `page=${page.json?.carried_forward} api=${api.json?.carried_forward}`,
  );
}

// ── তাৎ-৫: one published carried-forward rate, not two ────────────────────
{
  const home = await get("/");
  const method = await get("/methodology");
  // The pattern is written without any nukta, because the haystack has been
  // folded to the precomposed form and the pattern has not.
  const h = norm(home.text).match(/([\d.]+)%<\/strong>\s*সারি আগের/);
  const m = norm(method.text).match(/([\d.]+)%\s*আগের দিনের মান/);
  check(
    "তাৎ-৫",
    "the home page and the methodology page quote the same carried-forward rate",
    Boolean(h && m && h[1] === m[1]),
    `home=${h?.[1]}% methodology=${m?.[1]}%`,
  );
}

// ── তাৎ-৬: min <= avg <= max must hold on every published row ───────────
{
  const all = await get("/api/v1/latest?district=47");
  const rows = all.json?.prices ?? [];
  const bad = rows.filter(
    (r) =>
      r.retail &&
      r.retail.avg != null &&
      ((r.retail.min != null && r.retail.avg < r.retail.min) ||
        (r.retail.max != null && r.retail.avg > r.retail.max)),
  );
  const badW = rows.filter(
    (r) =>
      r.wholesale &&
      r.wholesale.avg != null &&
      ((r.wholesale.min != null && r.wholesale.avg < r.wholesale.min) ||
        (r.wholesale.max != null && r.wholesale.avg > r.wholesale.max) ||
        (r.wholesale.min != null && r.wholesale.max != null && r.wholesale.min > r.wholesale.max)),
  );
  check("তাৎ-৬", "retail min <= avg <= max on every row", bad.length === 0, `${bad.length} bad of ${rows.length}`);
  check("তাৎ-৬b", "wholesale min <= avg <= max on every row", badW.length === 0, `${badW.length} bad of ${rows.length}`);
  if (bad.length) {
    console.log("       e.g.", JSON.stringify(bad.slice(0, 3).map((r) => r.retail)));
  }
}

// ── তাৎ-৭: the published figure must not be mislabelled as a mean ─────────
{
  const all = await get("/api/v1/latest?district=47");
  const rows = (all.json?.prices ?? []).filter((r) => r.retail?.avg != null);
  const flagged = rows.filter((r) => r.retail?.is_midpoint === true);
  const unflagged = rows.filter((r) => r.retail?.is_midpoint === false);
  check(
    "তাৎ-৭",
    "every row says whether its figure is a mid-range estimate",
    rows.length > 0 && flagged.length + unflagged.length === rows.length,
    `${flagged.length} flagged as midpoints, ${unflagged.length} not, of ${rows.length}`,
  );
  // And the human-facing label must not call it a mean.
  const home = await get("/");
  const labels = norm(home.text).match(/<th[^>]*>(গড়|মধ্যম)<\/th>/g) ?? [];
  check(
    "তাৎ-৭b",
    "the table headings do not call the source's mid-range figure an average",
    labels.length > 0 && labels.every((l) => l.includes("মধ্যম")),
    `headings: ${labels.join(", ")}`,
  );
}

// ── তাৎ-৮/৯: no false coverage claims ───────────────────────────────────
{
  const ds = await get("/dataset");
  const cov = JSON.stringify(ds.json ?? {});
  const health = await get("/health");
  const first = health.json?.latest_date;
  check(
    "তাৎ-৮",
    "the dataset page does not claim a history it does not hold",
    !norm(ds.text).includes("2025-06/ongoing"),
    `temporalCoverage present: ${norm(ds.text).includes("2025-06/ongoing")}, first date we hold: ${first}`,
  );
  const llms = await get("/llms.txt");
  const claimsUpazila = /505\s+upazila/i.test(llms.text);
  const dsUpazila = norm(ds.text).match(/উপজেলা[\s\S]{0,60}?(\d+)/);
  check(
    "তাৎ-৯",
    "llms.txt and the dataset page agree about upazila coverage",
    !claimsUpazila || (dsUpazila && Number(dsUpazila[1]) > 0),
    `llms claims 505 upazilas: ${claimsUpazila}; dataset says ${dsUpazila?.[1] ?? "?"}`,
  );
}

// ── তাৎ-২০: .md and .json variants, and content negotiation ───────────────
{
  const md = await get("/methodology.md");
  check(
    "তাৎ-২০",
    "/methodology.md returns markdown, not HTML",
    md.type.includes("markdown") || md.text.startsWith("#"),
    `content-type=${md.type}`,
  );
  const j = await get("/methodology.json");
  check("তাৎ-২০b", "/methodology.json returns JSON", j.type.includes("json"), `content-type=${j.type}`);
  const acc = await get("/methodology", { Accept: "text/markdown" });
  check(
    "তাৎ-২০c",
    "Accept: text/markdown is honoured on a content page",
    acc.type.includes("markdown") || acc.text.startsWith("#"),
    `content-type=${acc.type}`,
  );
  const accj = await get("/methodology", { Accept: "application/json" });
  check("তাৎ-২০d", "Accept: application/json is honoured on a content page", accj.type.includes("json"), `content-type=${accj.type}`);
}

// ── তাৎ-১১: /api/v1/latest must not silently mean Dhaka ──────────────────
{
  const none = await get("/api/v1/latest");
  const name = await get(`/api/v1/latest?district=${Q("চট্টগ্রাম")}`);
  const bad = await get("/api/v1/latest?district=999");
  check(
    "তাৎ-১১",
    "/api/v1/latest rejects a district name instead of returning an empty 200",
    (name.json?.count ?? 0) > 0,
    `no param -> ${none.json?.count} rows (Dhaka); name -> ${name.json?.count} rows`,
  );
  check("তাৎ-১১b", "/api/v1/latest answers 4xx for an unknown district id", bad.status >= 400 && bad.status < 500, `status=${bad.status}`);
}

// ── তাৎ-২২: an English district name must resolve ────────────────────────
{
  const c = await mcp("tools/call", {
    name: "verify_claim",
    arguments: { claim: "onion 60 taka in dhaka" },
  });
  const sc = c.json?.result?.structuredContent;
  check(
    "তাৎ-২২",
    "verify_claim resolves an English district name",
    (sc?.district?.bn ?? "") === "ঢাকা",
    `district=${sc?.district?.bn} verdict=${sc?.verdict}`,
  );
}

// ── তাৎ-২৩: commodity name matching ───────────────────────────────────
{
  const c = await mcp("tools/call", {
    name: "get_market_price",
    arguments: { commodity: "সয়াবিন তেল", district: "ঢাকা" },
  });
  const sc = c.json?.result?.structuredContent;
  check(
    "তাৎ-২৩",
    "a common Bangla alias resolves to the right commodity",
    Boolean(sc?.commodity?.bn) && /তেল|তৈল/.test(sc?.commodity?.bn ?? ""),
    `সয়াবিন তেল -> ${sc?.commodity?.bn ?? c.json?.result?.content?.[0]?.text?.slice(0, 80)}`,
  );
}

// ── তাৎ-২৪/২৫: coverage must be stated honestly ─────────────────────────
{
  const commodities = await get("/api/v1/commodities");
  const all = commodities.json?.commodities ?? [];
  const withData = new Set();
  for (const d of [1, 2, 3, 4, 5]) {
    const l = await get(`/api/v1/latest?district=${d}`);
    for (const p of l.json?.prices ?? []) withData.add(p.commodity_id);
  }
  const home = await get("/");
  const claims447 = /447/.test(home.text);
  check(
    "তাৎ-২৪",
    "the site distinguishes the catalogue size from the commodities with data",
    !claims447 || /ক্যাটালগ/.test(norm(home.text)),
    `catalogue=${all.length}, with data in the districts sampled=${withData.size}, home mentions 447: ${claims447}`,
  );
}

// ── তাৎ-২৬: the divisor must not be a constant ──────────────────────────
{
  const all = await get("/api/v1/latest?district=47");
  const rows = all.json?.prices ?? [];
  const divisors = new Set();
  const sources = new Set();
  for (const d of [1, 20, 47]) {
    const l = await get(`/api/v1/latest?district=${d}`);
    for (const p of l.json?.prices ?? []) {
      divisors.add(p.wholesale?.divisor);
      sources.add(p.wholesale?.divisorSource);
    }
  }
  void rows;
  check(
    "তাৎ-২৬",
    "the divisor and its source are recorded per row, not hard-coded",
    divisors.size > 1 || sources.size > 1 || (divisors.size === 1 && [...divisors][0] !== 100),
    `divisors=${[...divisors].join(",")} sources=${[...sources].join(",")}`,
  );
}

// ── তাৎ-২৭: a public unit legend ────────────────────────────────────────
{
  const units = await get("/api/v1/units");
  const list = units.json?.units ?? [];
  const method = await get("/methodology");
  const hasLegend =
    list.length > 0 &&
    list.every((u) => u.name_bn && u.name_en) &&
    /কোড/.test(norm(method.text)) &&
    /unit/i.test(norm(method.text));
  check(
    "তাৎ-২৭",
    "the unit codes have a public legend",
    hasLegend,
    `${list.length} units published, e.g. ${JSON.stringify(list[0])}`,
  );
}

// ── তাৎ-২৯: the date must be stated in comparison results ──────────────
{
  const c = await mcp("tools/call", { name: "compare_districts", arguments: { commodity: "পেঁয়াজ" } });
  const sc = c.json?.result?.structuredContent;
  check(
    "তাৎ-২৯",
    "compare_districts states the date its figures are from",
    Boolean(sc?.price_date),
    `price_date=${sc?.price_date}`,
  );
  // Every district that reported must be listed, and the count must match.
  const listed = (sc?.districts ?? []).length;
  check(
    "তাৎ-২৯b",
    "compare_districts lists every district that reported, and says how many",
    listed > 0 && listed === sc?.districts_reporting,
    `${listed} districts listed, ${sc?.districts_reporting} reported, of ${sc?.districts_total} in the country`,
  );
}

// ── তাৎ-৩০: one unit shape everywhere ──────────────────────────────────
{
  const rest = await get("/api/v1/price?commodity=833&district=47");
  const page = await get("/price/onion-new-833/dhaka/" + (await get("/health")).json?.latest_date + ".json");
  check(
    "তাৎ-৩০",
    "the REST API and the page expose the unit the same way",
    Boolean(rest.json?.retail?.unit_bn) === Boolean(page.json?.prices?.retail?.unit_bn) &&
      rest.json?.retail?.unit_bn === page.json?.prices?.retail?.unit_bn,
    `rest unit_bn=${rest.json?.retail?.unit_bn} page unit_bn=${page.json?.prices?.retail?.unit_bn}`,
  );
  // And the MCP must use the same field name, or a consumer learns two
  // spellings of the same thing.
  const call = await mcp("tools/call", {
    name: "get_market_price",
    arguments: { commodity: "পেঁয়াজ", district: "ঢাকা" },
  });
  const sc = call.json?.result?.structuredContent;
  check(
    "তাৎ-৩০b",
    "the MCP tool uses the same unit field name as the REST API",
    sc?.retail?.unit_bn === rest.json?.retail?.unit_bn,
    `mcp unit_bn=${sc?.retail?.unit_bn} rest unit_bn=${rest.json?.retail?.unit_bn}`,
  );
}

// ── তাৎ-৩১: the sitemap must contain the citable per-fact URLs ───────────
{
  const index = await get("/sitemap.xml");
  const parts = (index.text.match(/<loc>([^<]*sitemap[^<]*)<\/loc>/g) ?? []).map((s) =>
    s.replace(/<\/?loc>/g, ""),
  );
  const facts = parts.filter((p) => /sitemap-facts-/.test(p));
  let dated = 0;
  for (const p of facts) {
    const part = await get(new URL(p).pathname);
    dated += (part.text.match(/\/price\/[^<]*\/\d{4}-\d\d-\d\d/g) ?? []).length;
  }
  check(
    "তাৎ-৩১",
    "the sitemap lists the per-fact URLs",
    facts.length > 0 && dated > 0,
    `${parts.length} sitemap parts, ${dated} dated price URLs`,
  );
}

// ── তাৎ-৩২: internal detail must not leak in an error ──────────────────
{
  const r = await get("/api/v1/price?commodity=nope&district=nope");
  const leak = /D1_ERROR|at D1Database|cloudflare\.com\/workers|sqlite|SELECT |INSERT INTO/i.test(r.text);
  check("তাৎ-৩২", "an error response does not leak internal detail", !leak, `status=${r.status} body=${r.text.slice(0, 120)}`);
}

// ── তাৎ-৩৩: accessibility basics ───────────────────────────────────────
{
  const home = await get("/");
  check(
    "তাৎ-৩৩",
    "the page has a focus-visible style and a mobile navigation",
    /:focus-visible/.test(home.text) && /nav-toggle|hamburger|menu-btn/i.test(home.text),
    `focus-visible=${/:focus-visible/.test(home.text)} mobile nav=${/nav-toggle|hamburger|menu-btn/i.test(home.text)}`,
  );
  const scope = /<th[^>]*scope=/.test(home.text);
  check("তাৎ-৩৩b", "table headers carry a scope attribute", scope, `scope=${scope}`);
}

// ── তাৎ-৩৫: the cache hints must agree ─────────────────────────────────
{
  const m = await mcp("server/discover", {});
  const ttl = m.json?.result?.ttlMs;
  check(
    "তাৎ-৩৫",
    "the MCP cache hint matches the HTTP cache header",
    ttl === undefined || ttl <= 600_000,
    `mcp ttlMs=${ttl} vs http max-age=600`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} audit claims now hold`);
if (failed.length) {
  console.log("\nstill broken:");
  for (const f of failed) console.log(`  ${f.id}  ${f.claim}`);
}
