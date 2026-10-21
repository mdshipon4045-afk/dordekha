// Build a KV snapshot from a D1 export, so the site keeps serving when the
// database's daily read budget is exhausted.
//
//   node tools/build-snapshot.mjs backup.sql <BASE_URL> <ADMIN_TOKEN>
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "backup.sql";
const base = process.argv[3] ?? "https://dordekha.shouroveh9.workers.dev";
const token = process.argv[4] ?? "";

// The export is UTF-16LE.
let raw = readFileSync(file);
if (raw[0] === 0xff && raw[1] === 0xfe) raw = raw.subarray(2);
let sql = raw.toString("utf16le");
if (!sql.includes("INSERT INTO")) {
  // maybe it is plain utf-8 after all
  sql = readFileSync(file, "utf8");
}

/** Pull the values out of one INSERT statement. */
function parseInsert(statement) {
  const i = statement.indexOf("VALUES");
  if (i < 0) return [];
  let body = statement.slice(i + 6).trim();
  if (body.endsWith(";")) body = body.slice(0, -1);
  const rows = [];
  let cur = "";
  let inStr = false;
  let depth = 0;
  for (let p = 0; p < body.length; p++) {
    const ch = body[p];
    if (inStr) {
      if (ch === "'") {
        if (body[p + 1] === "'") {
          cur += "'";
          p++;
          continue;
        }
        inStr = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "(") {
      depth++;
      if (depth === 1) {
        cur = "";
        continue;
      }
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        rows.push(cur);
        cur = "";
        continue;
      }
    }
    if (ch === "," && depth === 1) {
      cur += "\u0001";
      continue;
    }
    if (depth >= 1) cur += ch;
  }
  return rows.map((r) => r.split("\u0001"));
}

function collect(table) {
  const out = [];
  const re = new RegExp(`INSERT INTO "${table}"[^\\n]*`, "g");
  let m;
  while ((m = re.exec(sql))) {
    for (const row of parseInsert(m[0])) out.push(row);
  }
  return out;
}

const num = (v) => (v === "" || v === "NULL" || v === undefined ? null : Number(v));

const districts = new Map();
for (const r of collect("district")) districts.set(Number(r[0]), { bn: r[1], en: r[2] });

const groups = new Map();
for (const r of collect("commodity_group")) groups.set(Number(r[0]), { bn: r[1] });

const commodities = new Map();
{
  const cCols = columnsOf("commodity");
  const ci = (n) => cCols.indexOf(n);
  for (const r of collect("commodity")) {
    const id = Number(r[ci("id")]);
    const groupId = Number(r[ci("commodity_group_id")] ?? 0);
    commodities.set(id, {
      bn: r[ci("name_bn")],
      en: r[ci("name_en")],
      group: groupId,
      groupBn: groups.get(groupId)?.bn ?? "",
      unitRetail: num(r[ci("unit_retail")]),
      unitWholesale: num(r[ci("unit_whole_sale")]),
    });
  }
}

const units = new Map();
for (const r of collect("unit")) units.set(Number(r[0]), { bn: r[1], en: r[2] });

/**
 * The column order of a table, read from the dump's CREATE TABLE.
 * Indexing by position is how you build a snapshot that quietly reads the
 * wrong columns, so the order is taken from the schema itself.
 */
function columnsOf(table) {
  const i = sql.indexOf(`CREATE TABLE ${table} (`);
  if (i < 0) return [];
  const body = sql.slice(i, sql.indexOf(")", i));
  const cols = [];
  for (const line of body.split("\n")) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s+(?:INTEGER|REAL|TEXT|TIMESTAMP|BLOB|NUMERIC)/i.exec(line);
    if (m) cols.push(m[1]);
  }
  return cols;
}

const plCols = columnsOf("price_latest");
console.log(`price_latest columns: ${plCols.join(", ")}`);
const idx = (name) => plCols.indexOf(name);

const pl = collect("price_latest");
console.log(`price_latest rows: ${pl.length}`);

const rows = [];
for (const r of pl) {
  const districtId = Number(r[idx("district_id")]);
  const upazila = Number(r[idx("upazila_id")]);
  if (upazila !== 0) continue;
  if (districtId === 0) continue; // the national aggregate is not a district
  const retailUnit = num(r[idx("retail_unit")]);
  const wholesaleUnit = num(r[idx("wholesale_unit")]);
  rows.push({
    d: districtId,
    c: Number(r[idx("commodity_id")]),
    g: Number(r[idx("group_id")]),
    t: String(r[idx("price_date")] ?? ""),
    rmin: num(r[idx("retail_min")]),
    rmax: num(r[idx("retail_max")]),
    ravg: num(r[idx("retail_avg")]),
    ru: retailUnit,
    wmin: num(r[idx("wholesale_min")]),
    wmax: num(r[idx("wholesale_max")]),
    wavg: num(r[idx("wholesale_avg")]),
    wu: wholesaleUnit ?? retailUnit,
    cf: Number(r[idx("carried_forward")]) === 1 ? 1 : 0,
    an: r[idx("anomaly")] && r[idx("anomaly")] !== "NULL" ? r[idx("anomaly")] : null,
  });
}
console.log(`snapshot rows (districts only): ${rows.length}`);

// Aggregates, computed from the same export.
const dates = new Set(rows.map((r) => r.t));
const latest = [...dates].sort().pop() ?? null;
const first = [...dates].sort().shift() ?? null;
const lastRows = rows.filter((r) => r.t === latest);
const carried = lastRows.filter((r) => r.cf === 1).length;
const carriedPct = lastRows.length ? Math.round((carried / lastRows.length) * 1000) / 10 : null;

const byDistrict = new Map();
for (const r of rows) byDistrict.set(r.d, (byDistrict.get(r.d) ?? 0) + 1);
let busiest = [47, 0];
for (const [d, n] of byDistrict) if (n > busiest[1]) busiest = [d, n];

const historyRows = [];

// The price history, so that "what was the price on date X" keeps working
// when the database cannot be read.
{
  const hCols = columnsOf("price_daily");
  const hi = (n) => hCols.indexOf(n);
  const hrows = collect("price_daily");
  for (const r of hrows) {
    const d = Number(r[hi("district_id")]);
    if (d === 0) continue;
    const ru = num(r[hi("retail_unit")]);
    const wu = num(r[hi("wholesale_unit")]);
    historyRows.push({
      t: String(r[hi("price_date")] ?? ""),
      d,
      c: Number(r[hi("commodity_id")]),
      rmin: num(r[hi("retail_min")]),
      rmax: num(r[hi("retail_max")]),
      ravg: num(r[hi("retail_avg")]),
      ru,
      wmin: num(r[hi("wholesale_min")]),
      wmax: num(r[hi("wholesale_max")]),
      wavg: num(r[hi("wholesale_avg")]),
      wu: wu ?? ru,
      cf: Number(r[hi("carried_forward")]) === 1 ? 1 : 0,
    });
  }
  console.log(`history rows: ${historyRows.length}`);
}

const payload = {
  snapshot: { at: new Date().toISOString(), date: latest, rows },
  aggregates: {
    latestDate: latest,
    firstDate: first,
    days: dates.size,
    rowCount: rows.length,
    commodityCount: commodities.size,
    districtCount: districts.size - 1,
    carriedPct,
    busiestDistrictId: busiest[0],
    busiestDistrictName: districts.get(busiest[0])?.bn ?? "ঢাকা",
  },
  master: {
    at: new Date().toISOString(),
    commodities: [...commodities.entries()].map(([id, c]) => ({
      id,
      nameBn: c.bn,
      nameEn: c.en,
      groupId: c.group ?? 0,
      groupBn: c.groupBn ?? "",
      unitRetail: c.unitRetail ?? null,
      unitWholesale: c.unitWholesale ?? null,
    })),
    districts: [...districts.entries()]
      .filter(([id]) => id > 0)
      .map(([id, d]) => ({ id, nameBn: d.bn, nameEn: d.en })),
    units: [...units.entries()].map(([id, u]) => ({ id, nameBn: u.bn, nameEn: u.en })),
  },
  history: { rows: historyRows },
};

const body = JSON.stringify(payload);
writeFileSync("snapshot.json", body);
console.log(`snapshot.json: ${(body.length / 1024).toFixed(0)} KB`);
console.log(`latest=${latest} days=${dates.size} rows=${rows.length} carried=${carriedPct}%`);

if (token) {
  const res = await fetch(`${base}/internal/snapshot-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": token },
    body,
  });
  console.log("upload:", res.status, (await res.text()).slice(0, 200));
} else {
  console.log("no admin token given — wrote snapshot.json only");
}
