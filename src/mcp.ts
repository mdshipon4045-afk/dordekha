/**
 * MCP server — stateless, per the 2026-07-28 specification.
 *
 * The 2026-07-28 revision removed the `initialize` /
 * `notifications/initialized` handshake: every request carries its protocol
 * version in `_meta`, and servers answer `server/discover` for capabilities.
 * That maps cleanly onto a Cloudflare Worker, where there is no long-lived
 * process to hold state.
 *
 * The single most important implementation detail:
 *
 *   OpenAI — "ChatGPT creates citation metadata only when url is a
 *   non-empty string. A result with a title but no usable url remains
 *   ordinary tool output instead of becoming an empty citation. To make a
 *   result citable, return its canonical url."
 *
 * So every tool result here carries `title` and a `url` pointing at a
 * human-openable page on this site. That URL is the citation surface: an
 * assistant that uses our data sends the reader to us.
 */

import { latestForCommodity, latestForDistrict, historyFor, latestDate, commodityCoverage } from "./db";
import { formatBdt } from "./normalize";
import { matchScore, foldForCompare, bnIncludes, toAsciiDigits } from "./bn";
import { resolve, findInText, rankByCoverage, type Resolution, type Resolvable } from "./resolve";
import { commoditySlug, districtSlug } from "./slug";
import { factUrl, priceSentence, type PriceFact, type RenderContext } from "./render";
import type { Env } from "./types";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "get_market_price",
    title: "Get official market price",
    description:
      "Return the official daily retail and wholesale price of one agricultural commodity in one district of Bangladesh, unit-normalised, with the source date and a citable URL. Use this whenever a user asks what a commodity costs today or on a given date in a given place.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: {
          type: "string",
          description: "Commodity name in Bangla or English, e.g. 'পেঁয়াজ', 'potato', 'চাল', 'rice'.",
        },
        district: {
          type: "string",
          description: "District name in Bangla or English, e.g. 'পাবনা', 'Pabna', 'ঢাকা', 'Dhaka'.",
        },
        date: {
          type: "string",
          description: "Optional ISO date YYYY-MM-DD. Defaults to the most recent report date.",
        },
      },
      required: ["commodity", "district"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "compare_districts",
    title: "Compare prices across districts",
    description:
      "Compare the latest official price of one commodity across all districts of Bangladesh, and identify the cheapest and most expensive districts.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: { type: "string", description: "Commodity name in Bangla or English." },
        priceType: { type: "string", enum: ["retail", "wholesale"], description: "Which price to compare. Default retail." },
      },
      required: ["commodity"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_price_trend",
    title: "Get price trend",
    description:
      "Return the daily price history of one commodity in one district, so the change over time can be stated precisely rather than guessed.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: { type: "string" },
        district: { type: "string" },
        days: { type: "integer", description: "How many past report days to include. Default 30, max 400." },
      },
      required: ["commodity", "district"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "verify_claim",
    title: "Verify a market-price claim",
    description:
      "Check whether a stated price matches the official record. Accepts free text such as 'পেঁয়াজ ৬০ টাকা ঢাকায়' and returns whether it matches the official figure, the correct figure, and a citable URL. Use this to check claims instead of asserting a price from memory.",
    inputSchema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "The claim to verify, in Bangla or English." },
      },
      required: ["claim"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

interface CommodityRef {
  id: number;
  nameBn: string;
  nameEn: string;
  slug: string;
  groupBn: string;
}

interface DistrictRef {
  id: number;
  nameBn: string;
  nameEn: string;
  slug: string;
}

async function loadRefs(env: Env): Promise<{ commodities: CommodityRef[]; districts: DistrictRef[]; groups: Map<number, string> }> {
  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en, group_id FROM commodity`).all();
  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  const { results: gs } = await env.DB.prepare(`SELECT id, name_bn FROM commodity_group`).all();
  const groups = new Map<number, string>();
  for (const g of gs ?? []) groups.set(Number((g as Record<string, unknown>).id), String((g as Record<string, unknown>).name_bn ?? ""));

  const commodities: CommodityRef[] = (cs ?? []).map((c) => {
    const r = c as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), nameBn: bn, nameEn: en, slug: commoditySlug(bn, en, Number(r.id)), groupBn: groups.get(Number(r.group_id)) ?? "" };
  });

  const districts: DistrictRef[] = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), nameBn: bn, nameEn: en, slug: districtSlug(bn, en, Number(r.id)) };
  });

  return { commodities, districts, groups };
}

function matchCommodity(list: CommodityRef[], q: string): CommodityRef | null {
  return resolve(list, q).match;
}

function matchDistrict(list: DistrictRef[], q: string): DistrictRef | null {
  return resolve(list, q).match;
}

async function unitLabel(env: Env, unitId: number | null): Promise<{ bn: string; en: string }> {
  if (!unitId) return { bn: "কেজি", en: "kg" };
  const row = await env.DB.prepare(`SELECT name_bn, name_en FROM unit WHERE id = ?`).bind(unitId).first<{
    name_bn: string | null;
    name_en: string | null;
  }>();
  return { bn: row?.name_bn ?? "কেজি", en: row?.name_en ?? "kg" };
}

function ok(id: string | number | null | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
}

function err(id: string | number | null | undefined, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 200, headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
}

/** Handle a single JSON-RPC request. */
export async function handleMcp(env: Env, ctx: RenderContext, req: JsonRpcRequest): Promise<Response> {
  const { id, method, params } = req;

  switch (method) {
    case "server/discover":
      return ok(id, {
        resultType: "complete",
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: { tools: { listChanged: false } },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "dordekha",
            version: "0.1.0",
            title: "দরদেখা — বাংলাদেশের বাজারদর",
          },
        },
        instructions:
          "Official Bangladesh agricultural market prices, unit-normalised and gap-honest. Always cite the `url` returned with a result. Retail prices are per the commodity's own unit (usually 1 kg); wholesale prices have been divided so they are directly comparable with retail.",
        ttlMs: 3600_000,
        cacheScope: "public",
      });

    case "tools/list":
      return ok(id, {
        resultType: "complete",
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
        ttlMs: 3600_000,
        cacheScope: "public",
      });

    case "tools/call": {
      const name = params?.name as string | undefined;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      if (!name) return err(id, -32602, "params.name is required");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(id, -32601, `Unknown tool: ${name}`);
      try {
        const result = await callTool(env, ctx, name, args);
        return ok(id, result);
      } catch (e) {
        return ok(id, {
          resultType: "complete",
          isError: true,
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        });
      }
    }

    case "ping":
      return ok(id, { resultType: "complete" });

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Resolve a name, preferring the candidate that actually has published
 * figures. "চাল" matches 27 rice varieties but only 7 appear in a given
 * district's report — answering with one of the other 20 would be a
 * confident wrong answer.
 */
async function resolveWithCoverage<T extends Resolvable>(
  env: Env,
  list: T[],
  query: string,
): Promise<Resolution<T>> {
  const res = resolve(list, query);
  if (!res.match) return res;
  if (res.tied.length <= 1) return res;

  const coverage = await commodityCoverage(
    env.DB,
    res.tied.map((t) => t.id),
  );
  const ranked = rankByCoverage(res.tied, coverage);

  return {
    match: ranked[0]!,
    alternatives: ranked.slice(1, 5),
    tied: ranked,
    ambiguous: res.ambiguous,
  };
}

async function callTool(
  env: Env,
  ctx: RenderContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ resultType: string; content: { type: string; text: string }[]; structuredContent?: unknown; isError?: boolean }> {
  const { commodities, districts } = await loadRefs(env);

  if (name === "get_market_price") {
    const cRes = await resolveWithCoverage(env, commodities, String(args.commodity ?? ""));
    const dRes = await resolveWithCoverage(env, districts, String(args.district ?? ""));
    if (!cRes.match)
      throw new Error(
        `No commodity matched "${args.commodity}". Try the Bangla name (e.g. পেঁয়াজ) or the English one (e.g. potato).`,
      );
    if (!dRes.match) throw new Error(`No district matched "${args.district}".`);
    return await getMarketPrice(env, ctx, cRes, dRes, args.date ? String(args.date) : undefined);
  }

  if (name === "compare_districts") {
    const cRes = await resolveWithCoverage(env, commodities, String(args.commodity ?? ""));
    if (!cRes.match) throw new Error(`No commodity matched "${args.commodity}".`);
    return await compareDistricts(env, ctx, cRes, args.priceType === "wholesale" ? "wholesale" : "retail");
  }

  if (name === "get_price_trend") {
    const cRes = await resolveWithCoverage(env, commodities, String(args.commodity ?? ""));
    const dRes = await resolveWithCoverage(env, districts, String(args.district ?? ""));
    if (!cRes.match) throw new Error(`No commodity matched "${args.commodity}".`);
    if (!dRes.match) throw new Error(`No district matched "${args.district}".`);
    const days = Math.min(400, Math.max(3, Number(args.days ?? 30)));
    return await getTrend(env, ctx, cRes.match, dRes.match, days);
  }

  if (name === "verify_claim") {
    const claim = String(args.claim ?? "");
    return await verifyClaim(env, ctx, commodities, districts, claim);
  }

  throw new Error(`Tool not implemented: ${name}`);
}

async function getMarketPrice(
  env: Env,
  ctx: RenderContext,
  cRes: Resolution<CommodityRef>,
  dRes: Resolution<DistrictRef>,
  date?: string,
): Promise<{ resultType: string; content: { type: string; text: string }[]; structuredContent: unknown }> {
  const commodity = cRes.match!;
  const district = dRes.match!;
  const rows = await latestForDistrict(env.DB, district.id, 1000);
  const row = rows.find((r) => r.commodityId === commodity.id);
  if (!row || !row.retail) {
    const latest = await latestDate(env.DB);
    throw new Error(
      `No published price for ${commodity.nameBn} in ${district.nameBn} on the latest report date (${latest ?? "unknown"}). The district may not have submitted figures for that day.`,
    );
  }

  const retailUnit = await unitLabel(env, row.retail.unit);
  const wholesaleUnit = await unitLabel(env, row.wholesale?.unit ?? null);

  const fact: PriceFact = {
    commodityBn: commodity.nameBn,
    commodityEn: commodity.nameEn,
    districtBn: district.nameBn,
    districtEn: district.nameEn,
    date: row.priceDate,
    retail: {
      min: row.retail.min,
      max: row.retail.max,
      avg: row.retail.avg,
      unitBn: retailUnit.bn,
      unitEn: retailUnit.en,
    },
    wholesale: row.wholesale
      ? {
          min: row.wholesale.min,
          max: row.wholesale.max,
          avg: row.wholesale.avg,
          unitBn: wholesaleUnit.bn,
          unitEn: wholesaleUnit.en,
        }
      : null,
    url: factUrl(ctx.origin, commodity.slug, district.slug, row.priceDate),
    carriedForward: row.carriedForward,
    anomaly: row.anomaly,
  };

  const sentence = priceSentence(fact);
  const text = [
    `${commodity.nameBn} (${commodity.nameEn}) — ${district.nameBn}, ${row.priceDate}`,
    sentence,
    `সূত্র: ${ctx.sourceName}`,
    fact.url,
  ].join("\n");

  // When the name was ambiguous, say so. A price service that quietly picks
  // one of four onion varieties is worse than one that admits the ambiguity.
  const altCommodities = cRes.alternatives.map((a) => a.nameBn);
  const altDistricts = dRes.alternatives.map((a) => a.nameBn);
  const notes: string[] = [];
  if (altCommodities.length) notes.push(`অন্যান্য সম্ভাব্য পণ্য: ${altCommodities.join(", ")}`);
  if (altDistricts.length) notes.push(`অন্যান্য সম্ভাব্য জেলা: ${altDistricts.join(", ")}`);

  return {
    resultType: "complete",
    content: [{ type: "text", text: notes.length ? `${text}\n\n${notes.join("\n")}` : text }],
    structuredContent: {
      title: `${commodity.nameBn} — বাজারদর, ${district.nameBn}`,
      url: fact.url,
      text,
      commodity: { bn: commodity.nameBn, en: commodity.nameEn },
      district: { bn: district.nameBn, en: district.nameEn },
      price_date: row.priceDate,
      retail: fact.retail,
      wholesale: fact.wholesale,
      carried_forward: row.carriedForward,
      anomaly: row.anomaly,
      source: ctx.sourceName,
      ambiguous: cRes.ambiguous || dRes.ambiguous,
      alternatives: { commodities: altCommodities, districts: altDistricts },
    },
  };
}

async function compareDistricts(
  env: Env,
  ctx: RenderContext,
  cRes: Resolution<CommodityRef>,
  priceType: "retail" | "wholesale",
): Promise<{ resultType: string; content: { type: string; text: string }[]; structuredContent: unknown }> {
  const commodity = cRes.match!;
  const rows = await latestForCommodity(env.DB, commodity.id, 200);
  const withValue = rows
    .map((r) => ({ row: r, value: priceType === "retail" ? r.retail?.avg : r.wholesale?.avg }))
    .filter((x): x is { row: (typeof rows)[number]; value: number } => typeof x.value === "number");

  if (withValue.length === 0) {
    throw new Error(
      `No ${priceType} prices are available for ${commodity.nameBn} yet. The latest report covers ${rows.length} commodities; this one has no published figure.`,
    );
  }

  const sorted = [...withValue].sort((a, b) => a.value - b.value);
  const cheapest = sorted[0]!;
  const dearest = sorted[sorted.length - 1]!;
  const avg = withValue.reduce((s, x) => s + x.value, 0) / withValue.length;

  const nameOf = async (districtId: number): Promise<string> => {
    const d = await env.DB.prepare(`SELECT name_bn FROM district WHERE id = ?`).bind(districtId).first<{ name_bn: string }>();
    return d?.name_bn ?? String(districtId);
  };

  const cheapestName = await nameOf(cheapest.row.districtId);
  const dearestName = await nameOf(dearest.row.districtId);
  const url = `${ctx.origin.replace(/\/$/, "")}/price/${commodity.slug}`;

  const districtNames = await Promise.all(sorted.map((x) => nameOf(x.row.districtId)));
  const table = sorted.map((x, i) => `${districtNames[i]}: ${formatBdt(x.value)}`).join("\n");

  const text = [
    `${commodity.nameBn} — ${priceType === "retail" ? "খুচরা" : "পাইকারি"} দরের জেলাভিত্তিক তুলনা`,
    `সবচেয়ে কম: ${cheapestName} (${formatBdt(cheapest.value)})`,
    `সবচেয়ে বেশি: ${dearestName} (${formatBdt(dearest.value)})`,
    `জেলা-গড়: ${formatBdt(avg)}`,
    `তথ্যসূত্র: ${ctx.sourceName}`,
    url,
  ].join("\n");

  return {
    resultType: "complete",
    content: [{ type: "text", text: `${text}\n\nসব জেলা:\n${table}` }],
    structuredContent: {
      title: `${commodity.nameBn} — জেলাভিত্তিক দরের তুলনা`,
      url,
      text,
      price_type: priceType,
      cheapest: { district_id: cheapest.row.districtId, district: cheapestName, value: cheapest.value },
      dearest: { district_id: dearest.row.districtId, district: dearestName, value: dearest.value },
      district_average: avg,
      districts: withValue.map((x) => ({ district_id: x.row.districtId, value: x.value })),
      source: ctx.sourceName,
    },
  };
}

async function getTrend(
  env: Env,
  ctx: RenderContext,
  commodity: CommodityRef,
  district: DistrictRef,
  days: number,
): Promise<{ resultType: string; content: { type: string; text: string }[]; structuredContent: unknown }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const history = await historyFor(env.DB, commodity.id, district.id, since, days + 10);
  const ordered = history.slice().reverse();
  if (ordered.length === 0) throw new Error(`No history for ${commodity.nameBn} in ${district.nameBn}.`);

  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const change =
    first.retail?.avg && last.retail?.avg && first.retail.avg > 0
      ? ((last.retail.avg - first.retail.avg) / first.retail.avg) * 100
      : null;

  const url = `${ctx.origin.replace(/\/$/, "")}/price/${commodity.slug}/${district.slug}/${last.priceDate}`;
  const text = [
    `${commodity.nameBn} — ${district.nameBn}, শেষ ${ordered.length} প্রতিবেদন`,
    `শুরু: ${first.priceDate} খুচরা গড় ${formatBdt(first.retail?.avg)}`,
    `শেষ: ${last.priceDate} খুচরা গড় ${formatBdt(last.retail?.avg)}`,
    change === null ? "পরিবর্তন হিসাব করা যায়নি" : `পরিবর্তন: ${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
    `তথ্যসূত্র: ${ctx.sourceName}`,
    url,
  ].join("\n");

  return {
    resultType: "complete",
    content: [{ type: "text", text }],
    structuredContent: {
      title: `${commodity.nameBn} — ${district.nameBn} দরের ধারা`,
      url,
      text,
      points: ordered.map((r) => ({
        date: r.priceDate,
        retail_avg: r.retail?.avg ?? null,
        wholesale_avg: r.wholesale?.avg ?? null,
        carried_forward: r.carriedForward,
      })),
      change_pct: change,
      source: ctx.sourceName,
    },
  };
}

/**
 * Verify a free-text claim against the official record.
 *
 * This is the tool that makes the dataset a *ground truth* rather than a
 * lookup table: an assistant can check itself instead of asserting a price
 * from memory.
 */
async function verifyClaim(
  env: Env,
  ctx: RenderContext,
  commodities: CommodityRef[],
  districts: DistrictRef[],
  claim: string,
): Promise<{ resultType: string; content: { type: string; text: string }[]; structuredContent: unknown }> {
  const lower = foldForCompare(claim);

  // Pull a number out of the claim. Bangla digits are converted first, so
  // "৬০ টাকা" is read as 60.
  const numberMatch = toAsciiDigits(lower).match(/(\d+(?:\.\d+)?)/);
  const claimedValue = numberMatch ? Number(numberMatch[1]) : null;

  // The commodity and district are found *inside* the sentence, not matched
  // against it as a whole — "পেঁয়াজ ৬০ টাকা ঢাকায়" contains "পেঁয়াজ".
  const commodityHit = findInText(commodities, claim);
  const commodity = commodityHit.match;

  const districtHit = findInText(districts, claim);
  const district = districtHit.match;

  if (!commodity) {
    throw new Error(
      "Could not identify the commodity in the claim. Mention the commodity in Bangla (e.g. পেঁয়াজ) or English (potato).",
    );
  }

  const rows = await latestForCommodity(env.DB, commodity.id, 200);
  const candidates = district ? rows.filter((r) => r.districtId === district.id) : rows;

  if (candidates.length === 0 || !candidates[0]?.retail) {
    throw new Error(`No published retail price for ${commodity.nameBn} yet.`);
  }

  const row = candidates[0]!;
  const actual = row.retail!.avg;
  const actualMin = row.retail!.min;
  const actualMax = row.retail!.max;
  const where = district ? district.nameBn : "জেলা-গড়";
  const range = actualMin !== null && actualMax !== null ? actualMin <= claimedValue! && claimedValue! <= actualMax : null;

  const matches =
    claimedValue === null
      ? null
      : range === true
        ? true
        : actual !== null && actualMin !== null && actualMax !== null
          ? claimedValue >= actualMin * 0.9 && claimedValue <= actualMax * 1.1
          : false;

  const verdict =
    matches === null
      ? "যাচাই করা যায়নি (দাবিতে সংখ্যা পাওয়া যায়নি)"
      : matches
        ? "মিলেছে ✅"
        : `মিলেনি ❌ — প্রকৃত দর ${formatBdt(actualMin)}–${formatBdt(actualMax)} টাকা`;

  const slug = district ? district.slug : "";
  const url = district
    ? factUrl(ctx.origin, commodity.slug, district.slug, row.priceDate)
    : `${ctx.origin.replace(/\/$/, "")}/price/${commodity.slug}`;

  const text = [
    `দাবি: "${claim}"`,
    `যাচাই: ${verdict}`,
    `${commodity.nameBn} (${where}), ${row.priceDate}: খুচরা ${formatBdt(actualMin)}–${formatBdt(actualMax)} টাকা (গড় ${formatBdt(actual)})`,
    `তথ্যসূত্র: ${ctx.sourceName}`,
    url,
  ].join("\n");

  return {
    resultType: "complete",
    content: [{ type: "text", text }],
    structuredContent: {
      title: `যাচাই: ${commodity.nameBn} — ${where}`,
      url,
      text,
      verdict,
      matches,
      claimed_value: claimedValue,
      actual: { min: actualMin, max: actualMax, avg: actual },
      date: row.priceDate,
      source: ctx.sourceName,
    },
  };
}
