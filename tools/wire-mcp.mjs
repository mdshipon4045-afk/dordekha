// Route every MCP read through the cached helpers.
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/mcp.ts";
let s = readFileSync(path, "utf8");
const before = s;
const R = (from, to) => {
  if (!s.includes(from)) {
    console.log("NOT FOUND:", from.slice(0, 80).replace(/\n/g, "\\n"));
    return;
  }
  s = s.split(from).join(to);
};

R(
  `import { latestForCommodity, latestForDistrict, historyFor, latestDate, commodityCoverageOrSnapshot } from "./db";`,
  `import {
  commodityCoverageOrSnapshot,
  commodityRefs,
  districtRefs,
  historyForOrSnapshot,
  latestForCommodityOrSnapshot,
  latestForDistrictOrSnapshot,
  unitNames,
} from "./db";
import { getAggregates } from "./cache";`,
);

// the reference lists
R(
  `async function loadRefs(env: Env): Promise<{ commodities: CommodityRef[]; districts: DistrictRef[]; groups: Map<number, string> }> {
  const { results: cs } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM commodity\`).all();
  const { results: ds } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM district\`).all();
  const { results: gs } = await env.DB.prepare(\`SELECT id, name_bn FROM commodity_group\`).all();
  const groups = new Map<number, string>();
  for (const g of gs ?? []) groups.set(Number((g as Record<string, unknown>).id), String((g as Record<string, unknown>).name_bn ?? ""));

  const commodities: CommodityRef[] = (cs ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const id = Number(row.id);
    return { id, nameBn: String(row.name_bn ?? ""), nameEn: String(row.name_en ?? ""), slug: commoditySlug(String(row.name_bn ?? ""), String(row.name_en ?? ""), id) };
  });

  const districts: DistrictRef[] = (ds ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const id = Number(row.id);
    return { id, nameBn: String(row.name_bn ?? ""), nameEn: String(row.name_en ?? ""), slug: districtSlug(String(row.name_bn ?? ""), String(row.name_en ?? ""), id) };
  });

  return { commodities, districts, groups };
}`,
  `async function loadRefs(env: Env): Promise<{ commodities: CommodityRef[]; districts: DistrictRef[]; groups: Map<number, string> }> {
  const refs = await commodityRefs(env);
  const drefs = await districtRefs(env);
  const groups = new Map<number, string>();
  for (const c of refs) if (c.groupBn) groups.set(c.groupId, c.groupBn);

  const commodities: CommodityRef[] = refs.map((c) => ({
    id: c.id,
    nameBn: c.nameBn,
    nameEn: c.nameEn,
    slug: commoditySlug(c.nameBn, c.nameEn, c.id),
  }));

  const districts: DistrictRef[] = drefs.map((d) => ({
    id: d.id,
    nameBn: d.nameBn,
    nameEn: d.nameEn,
    slug: districtSlug(d.nameBn, d.nameEn, d.id),
  }));

  return { commodities, districts, groups };
}`,
);

// the reads
R(`await latestForDistrict(env.DB, district.id, 1000)`, `await latestForDistrictOrSnapshot(env, district.id, 1000)`);
R(`await latestForCommodity(env.DB, commodity.id, 200)`, `await latestForCommodityOrSnapshot(env, commodity.id, 200)`);
R(`await historyFor(env.DB, commodity.id, district.id, since, days)`, `await historyForOrSnapshot(env, commodity.id, district.id, since, days)`);
R(`await latestDate(env.DB)`, `(await getAggregates(env)).latestDate`);

// the unit names
R(
  `async function unitLabel(env: Env, unitId: number | null): Promise<{ bn: string; en: string }> {
  if (!unitId) return { bn: "কেজি", en: "kg" };
  const row = await env.DB.prepare(\`SELECT name_bn, name_en FROM unit WHERE id = ?\`).bind(unitId).first<{
    name_bn: string | null;
    name_en: string | null;
  }>();
  return { bn: row?.name_bn ?? "কেজি", en: row?.name_en ?? "kg" };
}`,
  `async function unitLabel(env: Env, unitId: number | null): Promise<{ bn: string; en: string }> {
  if (!unitId) return { bn: "কেজি", en: "kg" };
  const names = await unitNames(env);
  return { bn: names.get(unitId) ?? "কেজি", en: "kg" };
}`,
);

writeFileSync(path, s, "utf8");
console.log(before === s ? "NO CHANGES" : "mcp.ts updated");
