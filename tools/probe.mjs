// Live probe of the Ministry of Agriculture price API.
// Verifies: endpoint reachability, response shape, master data, unit bug, coverage.
const BASE = "https://moa-services.com/agri-service";
const PRICE = `${BASE}/crop-price-info/reports/price-report/market-daily-price-report`;
const DROPDOWNS = `${BASE}/common-all-dropdowns`;

const j = async (url, init) => {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t.slice(0, 300) }; }
};

const report = (s) => console.log(`\n=== ${s} ===`);

report("1. master dropdowns");
const dd = await j(DROPDOWNS);
const d = dd.body?.data ?? {};
console.log("status", dd.status, "bytes", JSON.stringify(dd.body).length);
for (const k of ["divisionList", "districtList", "upazilaList", "marketList", "commodityNameList", "commodityGroupList", "priceTypeList", "measurementUnitList"]) {
  console.log(`  ${k}:`, Array.isArray(d[k]) ? d[k].length : "MISSING");
}
console.log("  sample district:", JSON.stringify(d.districtList?.[0]));
console.log("  sample commodity:", JSON.stringify(d.commodityNameList?.[0]));
console.log("  priceTypeList:", JSON.stringify(d.priceTypeList));
console.log("  measurementUnitList:", JSON.stringify(d.measurementUnitList?.slice(0, 6)));

report("2. daily price report — Dhaka, 2 days ago");
const today = new Date();
const ymd = (dt) => dt.toISOString().slice(0, 10);
const d1 = ymd(new Date(today.getTime() - 2 * 86400000));
const body = {
  division_id: [], district_id: [47], upazila_id: [], market_id: [],
  price_type_id: ["Retail", "Wholesale"], select_type: "Daily",
  year: 0, month_id: 0, week_id: 0, price_date: d1,
};
const pr = await j(PRICE, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log("status", pr.status, "success", pr.body?.success, "msg", pr.body?.message);
const rows = pr.body?.data ?? [];
console.log("rows:", rows.length);
console.log("first row:", JSON.stringify(rows[0], null, 2));

report("3. unit-bug check (grain rows: retail kg vs wholesale quintal)");
const nameById = new Map((d.commodityNameList ?? []).map((c) => [c.value, c.text_bn]));
const unitById = new Map((d.measurementUnitList ?? []).map((u) => [u.value, u.text_bn ?? u.text_en]));
const grains = rows.filter((r) => r.r_avgPriceAvg && r.w_avgPriceAvg).slice(0, 12);
for (const r of grains) {
  const ret = Number(r.r_avgPriceAvg), wh = Number(r.w_avgPriceAvg);
  console.log(
    `  ${String(nameById.get(r.commodity_id) ?? r.commodity_id).padEnd(28)}` +
    ` retail=${ret} (u${r.unit_retail}=${unitById.get(r.unit_retail)})` +
    ` wholesale=${wh} (u${r.unit_wholesale}=${unitById.get(r.unit_wholesale)})` +
    ` ratio=${(wh / ret).toFixed(2)}  x0.3732=${(wh * 0.3732).toFixed(2)}`
  );
}

report("4. coverage across all districts (2 days ago)");
let total = 0, districtsWithData = 0;
const ddResp = await j(PRICE, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...body, district_id: [] }),
});
const all = ddResp.body?.data ?? [];
console.log("  all-district rows:", all.length, "success:", ddResp.body?.success);
const byDist = new Map();
for (const r of all) byDist.set(r.district_id ?? "n/a", (byDist.get(r.district_id ?? "n/a") ?? 0) + 1);
console.log("  distinct district_ids present:", byDist.size);
total = all.length;

report("5. date availability (last 10 days)");
for (let i = 1; i <= 10; i++) {
  const dt = ymd(new Date(today.getTime() - i * 86400000));
  const r = await j(PRICE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, price_date: dt }),
  });
  console.log(`  ${dt}: ${(r.body?.data ?? []).length} rows`);
}

report("6. national scroll (GET)");
const sc = await j(`${BASE}/crop-price-info/reports/price-report/daily-price-scroll`);
console.log("status", sc.status, "keys", Object.keys(sc.body ?? {}));
console.log("  sample:", JSON.stringify(sc.body).slice(0, 400));

report("7. row shape across a full district — all field names");
console.log(JSON.stringify([...new Set(rows.flatMap((r) => Object.keys(r)))], null, 2));
