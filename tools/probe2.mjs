// Derive the unit-normalization rule empirically from live data.
const BASE = "https://moa-services.com/agri-service";
const PRICE = `${BASE}/crop-price-info/reports/price-report/market-daily-price-report`;
const SCROLL = `${BASE}/crop-price-info/reports/price-report/daily-price-scroll`;

const j = async (url, init) => {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 200) }; }
};
const ymd = (dt) => dt.toISOString().slice(0, 10);
const post = (b) => j(PRICE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

const dd = (await j(`${BASE}/common-all-dropdowns`)).body?.data ?? {};
const units = new Map((dd.measurementUnitList ?? []).map((u) => [u.value, u]));
const commodities = new Map((dd.commodityNameList ?? []).map((c) => [c.value, c]));
const districts = dd.districtList ?? [];
const upazilas = dd.upazilaList ?? [];

console.log("=== FULL measurementUnitList ===");
for (const u of dd.measurementUnitList ?? []) console.log(`  id=${u.value}  en="${u.text_en}"  bn="${u.text_bn}"`);

const date = ymd(new Date(Date.now() - 2 * 86400000));
const base = { division_id: [], district_id: [], upazila_id: [], market_id: [], price_type_id: ["Retail", "Wholesale"], select_type: "Daily", year: 0, month_id: 0, week_id: 0, price_date: date };

console.log("\n=== ratio stats by (unit_retail, unit_wholesale) — Dhaka ===");
const dhaka = (await post({ ...base, district_id: [47] })).body?.data ?? [];
const groups = new Map();
for (const r of dhaka) {
  if (!r.r_avgPriceAvg || !r.w_avgPriceAvg) continue;
  const k = `${r.unit_retail}->${r.unit_wholesale}`;
  const ret = Number(r.r_avgPriceAvg), wh = Number(r.w_avgPriceAvg);
  if (!Number.isFinite(ret) || !Number.isFinite(wh) || ret <= 0) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({ ratio: wh / ret, per100: wh / 100, name: commodities.get(r.commodity_id)?.text_bn });
}
for (const [k, arr] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const ratios = arr.map((a) => a.ratio).sort((x, y) => x - y);
  const med = ratios[Math.floor(ratios.length / 2)];
  const sane = arr.filter((a) => a.per100 < a.ratio / 10).length;
  console.log(`  u${k}: n=${arr.length} ratio[min=${ratios[0].toFixed(1)} med=${med.toFixed(1)} max=${ratios[ratios.length - 1].toFixed(1)}]  | w/100 <= retail: ${sane}/${arr.length}`);
  console.log(`      units: retail=${units.get(Number(k.split("->")[0]))?.text_en}  wholesale=${units.get(Number(k.split("->")[1]))?.text_en}`);
  console.log(`      e.g. ${arr.slice(0, 3).map((a) => `${a.name} ratio=${a.ratio.toFixed(1)} w/100=${a.per100.toFixed(1)}`).join(" | ")}`);
}

console.log("\n=== cross-check: national scroll vs district (rule = wholesale is per 100kg) ===");
const sc = (await j(SCROLL)).body?.data ?? [];
const byCom = new Map(sc.map((r) => [r.commodity_id, r]));
let checked = 0, ok = 0, bad = 0;
for (const r of dhaka.slice(0, 400)) {
  const s = byCom.get(r.commodity_id);
  if (!s || !s.a_r_lowestPrice || !s.a_w_lowestPrice) continue;
  if (r.unit_retail !== 2 || r.unit_wholesale !== 1) continue;
  const natR = Number(s.a_r_lowestPrice);
  const natW = Number(s.a_w_lowestPrice) / 100;
  checked++;
  if (natW < natR) ok++; else { bad++; if (bad <= 5) console.log(`   MISMATCH ${commodities.get(r.commodity_id)?.text_bn}: natRetail=${natR} natW/100=${natW.toFixed(2)}`); }
}
console.log(`  grain rows cross-checked=${checked}  wholesale(/100) < retail: ${ok} ok, ${bad} bad`);

console.log("\n=== division_id behaviour ===");
for (const div of [1, 3, 6]) {
  const r = await post({ ...base, division_id: [div] });
  console.log(`  division ${div}: ${(r.body?.data ?? []).length} rows, success=${r.body?.success}`);
}
console.log(`  district_id:[] -> ${((await post(base)).body?.data ?? []).length} rows`);
console.log(`  upazila_id:[] only -> ${((await post({ ...base, district_id: [47], upazila_id: [upazilas.find((u) => u.district_id === 47)?.value] })).body?.data ?? []).length} rows`);

console.log("\n=== per-district iteration (all 64) ===");
let t0 = Date.now(), totalRows = 0, withData = 0, missing = [];
for (const dist of districts) {
  const r = await post({ ...base, district_id: [dist.value] });
  const n = (r.body?.data ?? []).length;
  totalRows += n;
  if (n > 0) withData++; else missing.push(dist.text_bn);
}
console.log(`  ${withData}/${districts.length} districts returned data, ${totalRows} rows total, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  missing: ${missing.join(", ") || "none"}`);

console.log("\n=== commodity groups (for the site taxonomy) ===");
const g = new Map((dd.commodityGroupList ?? []).map((x) => [x.value, x.text_bn]));
const cnt = new Map();
for (const c of dd.commodityNameList ?? []) {
  const k = c.commodity_group_id;
  cnt.set(k, (cnt.get(k) ?? 0) + 1);
}
for (const [gid, n] of [...cnt.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${g.get(gid) ?? gid}: ${n}`);
