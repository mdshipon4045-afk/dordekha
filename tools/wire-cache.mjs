// Wire the reference-data and history reads through the cached helpers.
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/index.ts";
let s = readFileSync(path, "utf8");
const before = s;
const R = (from, to) => {
  if (!s.includes(from)) {
    console.log("NOT FOUND:", from.slice(0, 70).replace(/\n/g, "\\n"));
    return;
  }
  s = s.split(from).join(to);
};

// ── imports ────────────────────────────────────────────────────────────────
R(
  `import {
  commodityCoverage,
  historyFor,
  ingestHealth,
  latestForCommodityOrSnapshot,
  latestForDistrictOrSnapshot,
  ledgerRows,
  movers,
  priceForDate,
} from "./db";`,
  `import {
  commodityCoverage,
  commodityRefs,
  districtRefs,
  historyForOrSnapshot,
  ingestHealth,
  latestForCommodityOrSnapshot,
  latestForDistrictOrSnapshot,
  ledgerRows,
  movers,
  priceForDateOrSnapshot,
  unitNames,
} from "./db";`,
);

// ── pricePage: commodity list ──────────────────────────────────────────────
R(
  `  const { results: cs } = await env.DB.prepare(\`SELECT id, name_bn, name_en, group_id FROM commodity\`).all();
  const commodities = (cs ?? []).map((c) => {
    const r = c as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: commoditySlug(bn, en, Number(r.id)) };
  });`,
  `  const commodities = (await commodityRefs(env)).map((c) => ({
    id: c.id,
    bn: c.nameBn,
    en: c.nameEn,
    groupId: c.groupId,
    groupBn: c.groupBn,
    slug: commoditySlug(c.nameBn, c.nameEn, c.id),
  }));`,
);

R(
  `  const { results: gs } = await env.DB.prepare(\`SELECT id, name_bn FROM commodity_group\`).all();
  const groups = new Map<number, string>();
  for (const g of gs ?? []) {
    groups.set(Number((g as Record<string, unknown>).id), String((g as Record<string, unknown>).name_bn ?? ""));
  }`,
  ``,
);

R(
  `  const { results: ds } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM district\`).all();
  const districts = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: districtSlug(bn, en, Number(r.id)) };
  });`,
  `  const districts = (await districtRefs(env)).map((d) => ({
    id: d.id,
    bn: d.nameBn,
    en: d.nameEn,
    slug: districtSlug(d.nameBn, d.nameEn, d.id),
  }));`,
);

// group name now comes with the commodity
R(
  `        groupBn:
          groups.get(
            Number(
              (cs ?? []).find((c) => Number((c as Record<string, unknown>).id) === commodity.id)?.["group_id"] ?? 0,
            ),
          ) ?? "",`,
  `        groupBn: commodity.groupBn,`,
);

// ── units ─────────────────────────────────────────────────────────────────
R(
  `  const { results: us } = await env.DB.prepare(\`SELECT id, name_bn FROM unit\`).all();
  const unitMap = new Map<number, string>();
  for (const u of us ?? []) {
    unitMap.set(Number((u as Record<string, unknown>).id), String((u as Record<string, unknown>).name_bn ?? "কেজি"));
  }`,
  `  const unitMap = await unitNames(env);`,
);

// ── priceIndex: commodity list ────────────────────────────────────────────
R(
  `  const { results: cs } = await env.DB
    .prepare(
      \`SELECT c.id, c.name_bn, c.name_en, c.group_id, g.name_bn AS group_bn,
              p.retail_avg, p.retail_unit
         FROM commodity c
         LEFT JOIN commodity_group g ON g.id = c.group_id
         LEFT JOIN price_latest p ON p.commodity_id = c.id AND p.district_id = 47 AND p.upazila_id = 0
        ORDER BY g.name_bn, c.name_bn\`,
    )
    .all();

  const items: PriceIndexItem[] = (cs ?? []).map((c) => {
    const r = c as Record<string, unknown>;
    const id = Number(r.id);
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return {
      bn,
      en,
      group: String(r.group_bn ?? ""),
      slug: commoditySlug(bn, en, id),
      retailAvg: r.retail_avg === null || r.retail_avg === undefined ? null : Number(r.retail_avg),
      unitBn: "কেজি",
    };
  });`,
  `  const refs = await commodityRefs(env);
  const dhaka = await latestForDistrictOrSnapshot(env, 47, 1000);
  const byCommodity = new Map(dhaka.map((r) => [r.commodityId, r.retail?.avg ?? null]));

  const items: PriceIndexItem[] = refs.map((c) => ({
    bn: c.nameBn,
    en: c.nameEn,
    group: c.groupBn,
    slug: commoditySlug(c.nameBn, c.nameEn, c.id),
    retailAvg: byCommodity.get(c.id) ?? null,
    unitBn: "কেজি",
  }));`,
);

// ── districtPage ──────────────────────────────────────────────────────────
R(
  `  const { results: ds } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM district\`).all();
  const districts = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: districtSlug(bn, en, Number(r.id)) };
  });
  const district = districts.find((d) => d.slug === slug);`,
  `  const districts = (await districtRefs(env)).map((d) => ({
    id: d.id,
    bn: d.nameBn,
    en: d.nameEn,
    slug: districtSlug(d.nameBn, d.nameEn, d.id),
  }));
  const district = districts.find((d) => d.slug === slug);`,
);

R(
  `  const { results: cs } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM commodity\`).all();
  const commodityById = new Map<number, { bn: string; slug: string }>();
  for (const c of cs ?? []) {
    const r = c as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    commodityById.set(Number(r.id), { bn, slug: commoditySlug(bn, en, Number(r.id)) });
  }`,
  `  const commodityById = new Map<number, { bn: string; slug: string }>();
  for (const c of await commodityRefs(env)) {
    commodityById.set(c.id, { bn: c.nameBn, slug: commoditySlug(c.nameBn, c.nameEn, c.id) });
  }`,
);

// ── searchFact: master data ───────────────────────────────────────────────
R(
  `  const { results: cs } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM commodity\`).all();
  const { results: ds } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM district\`).all();

  const commodityList = (cs ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return { id: Number(row.id), nameBn: String(row.name_bn ?? ""), nameEn: String(row.name_en ?? "") };
  });
  const districtList = (ds ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return { id: Number(row.id), nameBn: String(row.name_bn ?? ""), nameEn: String(row.name_en ?? "") };
  });`,
  `  const commodityList = await commodityRefs(env);
  const districtList = await districtRefs(env);`,
);

// ── history reads ─────────────────────────────────────────────────────────
R(
  `    const rows = await historyFor(env.DB, commodity, district, since, 400);`,
  `    const rows = await historyForOrSnapshot(env, commodity, district, since, 400);`,
);
R(
  `      const hist = await historyFor(env.DB, commodity.id, district.id, since, 400);`,
  `      const hist = await historyForOrSnapshot(env, commodity.id, district.id, since, 400);`,
);
R(
  `    ? await priceForDate(env.DB, commodity.id, district.id, date)`,
  `    ? await priceForDateOrSnapshot(env, commodity.id, district.id, date)`,
);

// ── sitemap ───────────────────────────────────────────────────────────────
R(
  `  const { results: cs } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM commodity\`).all();
  for (const c of cs ?? []) {
    const r = c as Record<string, unknown>;
    urls.push(
      \`\${base}/price/\${commoditySlug(String(r.name_bn ?? ""), String(r.name_en ?? ""), Number(r.id))}\`,
    );
  }
  const { results: ds } = await env.DB.prepare(\`SELECT id, name_bn, name_en FROM district\`).all();
  for (const d of ds ?? []) {
    const r = d as Record<string, unknown>;
    urls.push(
      \`\${base}/district/\${districtSlug(String(r.name_bn ?? ""), String(r.name_en ?? ""), Number(r.id))}\`,
    );
  }`,
  `  for (const c of await commodityRefs(env)) {
    urls.push(\`\${base}/price/\${commoditySlug(c.nameBn, c.nameEn, c.id)}\`);
  }
  for (const d of await districtRefs(env)) {
    urls.push(\`\${base}/district/\${districtSlug(d.nameBn, d.nameEn, d.id)}\`);
  }`,
);

// ── /api/v1/districts and /commodities ────────────────────────────────────
R(
  `  if (path === "/api/v1/districts") {
    const { results } = await env.DB
      .prepare(\`SELECT id, name_bn, name_en, division_id FROM district WHERE id > 0 ORDER BY name_bn\`)
      .all();
    return json({ count: (results ?? []).length, districts: results, source: SOURCE }, ctx);
  }`,
  `  if (path === "/api/v1/districts") {
    const list = await districtRefs(env);
    return json({ count: list.length, districts: list, source: SOURCE }, ctx);
  }`,
);
R(
  `  if (path === "/api/v1/commodities") {
    const { results } = await env.DB
      .prepare(
        \`SELECT c.id, c.name_bn, c.name_en, c.group_id, g.name_bn AS group_bn FROM commodity c LEFT JOIN commodity_group g ON g.id=c.group_id ORDER BY g.name_bn, c.name_bn\`,
      )
      .all();
    return json({ count: (results ?? []).length, commodities: results, source: SOURCE }, ctx);
  }`,
  `  if (path === "/api/v1/commodities") {
    const list = await commodityRefs(env);
    return json({ count: list.length, commodities: list, source: SOURCE }, ctx);
  }`,
);

writeFileSync(path, s, "utf8");
console.log(before === s ? "NO CHANGES" : "index.ts updated");
