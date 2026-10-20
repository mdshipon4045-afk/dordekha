/**
 * HTTP router.
 *
 * One canonical set of facts, served three ways (html / markdown / json),
 * plus an MCP endpoint and an operational API.
 *
 * Content negotiation follows the documented 2026 practice: branch on
 * `Accept`, never on `User-Agent` (that would be cloaking), always send
 * `Vary: Accept`, and keep the variants semantically identical.
 */

import { handleMcp, MCP_PROTOCOL_VERSION } from "./mcp";
import {
  historyFor,
  ingestHealth,
  latestDate,
  latestForCommodity,
  latestForDistrict,
} from "./db";
import { formatBdt, toAsciiNumber } from "./normalize";
import { matchScore } from "./bn";
import { resolve } from "./resolve";
import { refreshMaster, startIngest, stepIngest } from "./ingest";
import {
  esc,
  factUrl,
  layout,
  renderCommodityHtml,
  renderCommodityMarkdown,
  renderHomeHtml,
  renderHomeMarkdown,
  renderPriceFactHtml,
  renderPriceFactJson,
  renderPriceFactMarkdown,
  type CommodityPageData,
  type PriceFact,
  type RenderContext,
} from "./render";
import { commoditySlug, districtSlug } from "./slug";
import type { Env } from "./types";

const MD = "text/markdown; charset=utf-8";
const JSON_T = "application/json; charset=utf-8";
const HTML = "text/html; charset=utf-8";

export interface RouteResult {
  body: string | unknown;
  contentType: string;
  status?: number;
  headers?: Record<string, string>;
}

function ctxFor(env: Env, latest: string | null): RenderContext {
  return {
    origin: env.SITE_ORIGIN.replace(/\/$/, ""),
    sourceName: env.SOURCE_NAME,
    latestDate: latest,
    generatedAt: new Date().toISOString(),
  };
}

/** Does the client prefer markdown or json over html? */
function negotiate(accept: string | null): "html" | "markdown" | "json" {
  if (!accept) return "html";
  const a = accept.toLowerCase();
  if (a.includes("text/markdown")) return "markdown";
  if (a.includes("application/json") && !a.includes("text/html")) return "json";
  return "html";
}

type Format = "html" | "markdown" | "json";

/**
 * A `.md` or `.json` suffix on the path forces that representation, which is
 * the sibling-URL pattern agents use when they cannot send an Accept header.
 */
function splitSuffix(pathname: string): { path: string; forced: Format | null } {
  const p = pathname.replace(/\/+$/, "") || "/";
  const m = /\.(md|json)$/.exec(p);
  if (!m) return { path: p, forced: null };
  return { path: p.slice(0, -m[0].length), forced: m[1] === "md" ? "markdown" : "json" };
}

function withCommonHeaders(res: Response, ctx: RenderContext): Response {
  const h = new Headers(res.headers);
  h.set("Vary", "Accept");
  // HTTP header values must be ASCII. The source name is Bangla, so it is
  // carried in the body and llms.txt instead, and only an ASCII id goes here.
  h.set("X-Content-Source-Id", "moa-dam");
  h.set("X-Content-Source-Date", ctx.latestDate ?? "");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function md(body: string, ctx: RenderContext, status = 200): Response {
  return withCommonHeaders(
    new Response(body, {
      status,
      headers: {
        "Content-Type": MD,
        "Cache-Control": "public, max-age=600",
        "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
      },
    }),
    ctx,
  );
}

function json(data: unknown, ctx: RenderContext, status = 200): Response {
  return withCommonHeaders(
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "Content-Type": JSON_T, "Cache-Control": "public, max-age=600" },
    }),
    ctx,
  );
}

function html(body: string, ctx: RenderContext, status = 200): Response {
  return withCommonHeaders(
    new Response(body, {
      status,
      headers: {
        "Content-Type": HTML,
        "Cache-Control": "public, max-age=600",
        "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
      },
    }),
    ctx,
  );
}

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: to, "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { path, forced } = splitSuffix(url.pathname);
    const fmt: Format = forced ?? negotiate(request.headers.get("accept"));
    const latest = await latestDate(env.DB);
    const ctxR = ctxFor(env, latest);

    try {
      // ── MCP ────────────────────────────────────────────────────────────
      if (path === "/mcp") {
        if (request.method !== "POST") {
          return json(
            {
              error: "Method Not Allowed",
              hint: "POST JSON-RPC 2.0 requests here. Methods: server/discover, tools/list, tools/call.",
            },
            ctxR,
            405,
          );
        }
        const body = (await request.json()) as {
          jsonrpc: "2.0";
          id?: string | number | null;
          method: string;
          params?: Record<string, unknown>;
        };
        const res = await handleMcp(env, ctxR, body);
        const h = new Headers(res.headers);
        h.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
        h.set("Access-Control-Allow-Origin", "*");
        return new Response(res.body, { status: res.status, headers: h });
      }
      if (path === "/mcp" && request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      }

      // ── Operational ─────────────────────────────────────────────────────
      if (path === "/health") {
        const h = await ingestHealth(env.DB);
        const fresh =
          h.latestDate !== null && Date.now() - new Date(h.latestDate).getTime() < 5 * 86_400_000;
        return json(
          { ok: fresh && (h.rowsToday ?? 0) > 0, ...h },
          ctxR,
          fresh ? 200 : 503,
        );
      }

      if (path.startsWith("/internal/")) {
        const token = env.ADMIN_TOKEN;
        const provided = request.headers.get("X-Admin-Token") ?? url.searchParams.get("token");
        if (token && provided !== token) {
          return json({ error: "Forbidden" }, ctxR, 403);
        }
        const base = env.SITE_ORIGIN.replace(/\/$/, "");
        if (path === "/internal/ingest/start") {
          const job = await startIngest(env, base, token ?? "", (fn) => ctx.waitUntil(fn()));
          return json({ started: true, job }, ctxR);
        }
        if (path === "/internal/ingest/step") {
          const job = await stepIngest(env, base, token ?? "", (fn) => ctx.waitUntil(fn()));
          return json({ job }, ctxR);
        }
        if (path === "/internal/master/refresh") {
          const stats = await refreshMaster(env);
          return json({ refreshed: true, ...stats }, ctxR);
        }
        return json({ error: "Not Found" }, ctxR, 404);
      }

      // ── Static-ish documents ────────────────────────────────────────────
      if (path === "/robots.txt") return robotsTxt(env);
      if (path === "/llms.txt") return llmsTxt(env);
      if (path === "/sitemap.xml") return sitemap(env, latest);

      // ── API ────────────────────────────────────────────────────────────
      if (path.startsWith("/api/")) return apiRoutes(env, ctxR, url);

      // ── Pages ──────────────────────────────────────────────────────────
      if (path === "/") return homePage(env, ctxR, fmt);
      if (path === "/price") return priceIndex(env, ctxR, fmt);
      if (path === "/dataset") return datasetPage(env, ctxR);
      if (path === "/methodology") return methodologyPage(env, ctxR);
      if (path === "/licence") return licencePage(env, ctxR);
      if (path === "/api") return apiDocPage(env, ctxR);
      if (path === "/verify") return verifyPage(env, ctxR, request, url);

      const priceMatch = /^\/price\/([^/]+)(?:\/([^/]+))?(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(path);
      if (priceMatch) {
        return pricePage(env, ctxR, fmt, priceMatch[1]!, priceMatch[2] ?? null, priceMatch[3] ?? null);
      }

      const districtMatch = /^\/district\/([^/]+)$/.exec(path);
      if (districtMatch) return districtPage(env, ctxR, request, districtMatch[1]!);

      return notFound(env, ctxR);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("request failed", url.pathname, message, err instanceof Error ? err.stack : "");
      return json({ error: "Internal Error", message, path: url.pathname }, ctxR, 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The cron only starts the chain; each step is a separate, tiny invocation.
    const base = env.SITE_ORIGIN.replace(/\/$/, "");
    ctx.waitUntil(
      (async () => {
        try {
          await startIngest(env, base, env.ADMIN_TOKEN ?? "", (fn) => ctx.waitUntil(fn()));
        } catch (err) {
          console.error("ingest start failed", err);
        }
      })(),
    );
  },
};

// ── Page handlers ───────────────────────────────────────────────────────────

async function homePage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  const latest = ctx.latestDate;
  const { results: headlineRows } = await env.DB
    .prepare(
      `SELECT c.name_bn AS bn, c.name_en AS en, p.retail_avg AS avg, p.retail_min AS mn, p.retail_max AS mx, p.retail_unit AS unit
         FROM price_latest p JOIN commodity c ON c.id = p.commodity_id
        WHERE p.district_id = 47 AND p.upazila_id = 0 AND p.retail_avg IS NOT NULL
        ORDER BY p.commodity_id LIMIT 12`,
    )
    .all();

  const { results: groupRows } = await env.DB
    .prepare(
      `SELECT g.id AS id, g.name_bn AS bn, COUNT(c.id) AS count
         FROM commodity c JOIN commodity_group g ON g.id = c.group_id
        GROUP BY g.id ORDER BY count DESC`,
    )
    .all();

  const commodityCount = await env.DB.prepare(`SELECT COUNT(*) AS c FROM commodity`).first<{ c: number }>();
  const districtCount = await env.DB.prepare(`SELECT COUNT(*) AS c FROM district`).first<{ c: number }>();
  const days = await env.DB
    .prepare(`SELECT COUNT(DISTINCT price_date) AS c FROM price_daily WHERE district_id > 0`)
    .first<{ c: number }>();

  const unitMap = await unitLookup(env);
  const headline = (headlineRows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      bn: String(row.bn ?? ""),
      value: formatBdt(Number(row.avg)),
      unit: unitMap.get(Number(row.unit)) ?? "কেজি",
    };
  });

  const data = {
    latestDate: latest,
    headline,
    groups: (groupRows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return { id: Number(row.id), bn: String(row.bn ?? ""), count: Number(row.count ?? 0) };
    }),
    commodityCount: commodityCount?.c ?? 0,
    districtCount: districtCount?.c ?? 0,
    daysCovered: days?.c ?? 0,
  };

  const fmt2 = fmt;
  if (fmt2 === "markdown") return md(renderHomeMarkdown(data, ctx), ctx);
  if (fmt2 === "json") return json({ ...data, source: ctx.sourceName, canonical_url: `${ctx.origin}/` }, ctx);
  return html(renderHomeHtml(data, ctx), ctx);
}

async function priceIndex(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  const { results } = await env.DB
    .prepare(
      `SELECT c.id, c.name_bn, c.name_en, c.group_id, g.name_bn AS group_bn
         FROM commodity c LEFT JOIN commodity_group g ON g.id = c.group_id
        ORDER BY g.name_bn, c.name_bn`,
    )
    .all();
  const items = (results ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: Number(row.id),
      bn: String(row.name_bn ?? ""),
      en: String(row.name_en ?? ""),
      group: String(row.group_bn ?? ""),
      slug: commoditySlug(String(row.name_bn ?? ""), String(row.name_en ?? ""), Number(row.id)),
    };
  });

  if (fmt === "json") return json({ count: items.length, commodities: items, source: ctx.sourceName }, ctx);
  if (fmt === "markdown") {
    const lines = ["# পণ্যতালিকা — দরদেখা", "", `মোট ${items.length}টি পণ্য।`, ""];
    for (const i of items) lines.push(`- [${i.bn}](/price/${i.slug}) — ${i.group}`);
    return md(lines.join("\n"), ctx);
  }

  const body = `<h1>পণ্যতালিকা</h1>
<div class="answer"><p>দরদেখায় মোট ${items.length}টি পণ্যের দর প্রকাশ করা হয়। প্রতিটি পণ্যের পাতায় জেলা অনুযায়ী খুচরা ও পাইকারি দর, সাম্প্রতিক ধারা এবং উৎস রয়েছে।</p></div>
<div class="grid">${items
    .map(
      (i) =>
        `<div class="card"><div class="n"><a href="/price/${esc(i.slug)}">${esc(i.bn)}</a></div><div class="p">${esc(i.group)}</div></div>`,
    )
    .join("\n")}</div>`;

  return html(
    layout({
      title: "পণ্যতালিকা — বাংলাদেশের দৈনিক বাজারদর",
      description: `${items.length}টি পণ্যের জেলা-ভিত্তিক দৈনিক বাজারদর, উৎস ও তারিখসহ।`,
      canonical: `${ctx.origin}/price`,
      body,
      ctx,
    }),
    ctx,
  );
}

async function pricePage(
  env: Env,
  ctx: RenderContext,
  fmt: Format,
  commoditySlugParam: string,
  districtSlugParam: string | null,
  date: string | null,
): Promise<Response> {
  const { results: cs } = await env.DB
    .prepare(`SELECT id, name_bn, name_en, group_id FROM commodity`)
    .all();
  const commodities = (cs ?? []).map((c) => {
    const r = c as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: commoditySlug(bn, en, Number(r.id)) };
  });
  const commodity = commodities.find((c) => c.slug === commoditySlugParam);
  if (!commodity) return notFound(env, ctx);

  const { results: gs } = await env.DB.prepare(`SELECT id, name_bn FROM commodity_group`).all();
  const groups = new Map<number, string>();
  for (const g of gs ?? []) groups.set(Number((g as Record<string, unknown>).id), String((g as Record<string, unknown>).name_bn ?? ""));

  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  const districts = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: districtSlug(bn, en, Number(r.id)) };
  });

  const fmt2 = fmt;
  if (!districtSlugParam) {
    // Commodity page: all districts.
    const rows = await latestForCommodity(env.DB, commodity.id, 200);
    const enriched = rows.map((r) => {
      const d = districts.find((x) => x.id === r.districtId);
      return {
        ...r,
        districtNameBn: d?.bn ?? String(r.districtId),
        districtNameEn: d?.en ?? "",
        districtSlug: d?.slug ?? `d${r.districtId}`,
      };
    });

    const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const hist = await historyFor(env.DB, commodity.id, 47, since, 60);

    const data: CommodityPageData = {
      commodity: {
        id: commodity.id,
        bn: commodity.bn,
        en: commodity.en,
        slug: commodity.slug,
        groupBn: groups.get(
          Number(
            (cs ?? []).find((c) => Number((c as Record<string, unknown>).id) === commodity.id)?.["group_id"] ?? 0,
          ),
        ) ?? "",
      },
      date: ctx.latestDate,
      districtRows: enriched,
      history: hist
        .slice()
        .reverse()
        .map((h) => ({ date: h.priceDate, retailAvg: h.retail?.avg ?? null, wholesaleAvg: h.wholesale?.avg ?? null })),
      national: [],
    };

    if (fmt2 === "json") {
      return json(
        {
          commodity: { bn: commodity.bn, en: commodity.en, slug: commodity.slug },
          date: data.date,
          districts: enriched.map((r) => ({
            district: r.districtNameBn,
            district_id: r.districtId,
            retail: r.retail,
            wholesale: r.wholesale,
            carried_forward: r.carriedForward,
            anomaly: r.anomaly,
            url: factUrl(ctx.origin, commodity.slug, r.districtSlug, r.priceDate),
          })),
          source: ctx.sourceName,
        },
        ctx,
      );
    }
    if (fmt2 === "markdown") return md(renderCommodityMarkdown(data, ctx), ctx);
    return html(renderCommodityHtml(data, ctx), ctx);
  }

  const district = districts.find((d) => d.slug === districtSlugParam);
  if (!district) return notFound(env, ctx);

  const rows = await latestForDistrict(env.DB, district.id, 1000);
  const row = rows.find((r) => r.commodityId === commodity.id);
  if (!row) return notFound(env, ctx);

  const unitMap = await unitLookup(env);
  const retailUnit = unitMap.get(row.retail?.unit ?? null) ?? "কেজি";
  const wholesaleUnit = unitMap.get(row.wholesale?.unit ?? null) ?? "কেজি";

  const fact: PriceFact = {
    commodityBn: commodity.bn,
    commodityEn: commodity.en,
    districtBn: district.bn,
    districtEn: district.en,
    date: date ?? row.priceDate,
    retail: {
      min: row.retail?.min ?? null,
      max: row.retail?.max ?? null,
      avg: row.retail?.avg ?? null,
      unitBn: retailUnit,
      unitEn: retailUnit,
    },
    wholesale: row.wholesale
      ? {
          min: row.wholesale.min,
          max: row.wholesale.max,
          avg: row.wholesale.avg,
          unitBn: wholesaleUnit,
          unitEn: wholesaleUnit,
        }
      : null,
    url: factUrl(ctx.origin, commodity.slug, district.slug, date ?? row.priceDate),
    carriedForward: row.carriedForward,
    anomaly: row.anomaly,
  };

  if (fmt2 === "json") return json(renderPriceFactJson(fact, ctx), ctx);
  if (fmt2 === "markdown") return md(renderPriceFactMarkdown(fact, ctx), ctx);
  return html(renderPriceFactHtml(fact, ctx), ctx);
}

async function districtPage(env: Env, ctx: RenderContext, request: Request, slug: string): Promise<Response> {  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  const districts = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: districtSlug(bn, en, Number(r.id)) };
  });
  const district = districts.find((d) => d.slug === slug);
  if (!district) return notFound(env, ctx);

  const rows = await latestForDistrict(env.DB, district.id, 1000);
  const unitMap = await unitLookup(env);

  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM commodity`).all();
  const commodityById = new Map<number, { bn: string; slug: string }>();
  for (const c of cs ?? []) {
    const r = c as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    commodityById.set(Number(r.id), { bn, slug: commoditySlug(bn, en, Number(r.id)) });
  }

  const fmt = negotiate(request.headers.get("accept"));
  if (fmt === "json") {
    return json(
      {
        district: { bn: district.bn, en: district.en, id: district.id },
        date: ctx.latestDate,
        prices: rows.map((r) => ({
          commodity_id: r.commodityId,
          retail: r.retail,
          wholesale: r.wholesale,
          carried_forward: r.carriedForward,
          anomaly: r.anomaly,
        })),
        source: ctx.sourceName,
      },
      ctx,
    );
  }

  const bodyRows = rows
    .map((r) => {
      const c = commodityById.get(r.commodityId);
      return `<tr><td><a href="/price/${esc(c?.slug ?? String(r.commodityId))}/${esc(district.slug)}">${esc(c?.bn ?? String(r.commodityId))}</a></td>
      <td class="num">${esc(formatBdt(r.retail?.min))}–${esc(formatBdt(r.retail?.max))}</td>
      <td class="num">${esc(formatBdt(r.retail?.avg))}</td>
      <td class="num">${esc(formatBdt(r.wholesale?.avg))}</td>
      <td>${r.carriedForward ? '<span class="badge warn">পূর্বের মান</span>' : ""}</td></tr>`;
    })
    .join("\n");

  const title = `${district.bn} জেলার আজকের বাজারদর`;
  const body = `<nav class="crumbs"><a href="/">হোম</a> › ${esc(district.bn)}</nav>
<h1>${esc(title)} — ${esc(ctx.latestDate ?? "—")}</h1>
<div class="answer"><p>${esc(district.bn)} জেলায় ${rows.length}টি পণ্যের সরকারি বাজারদর সর্বশেষ প্রতিবেদনে পাওয়া গেছে। উৎস: ${esc(ctx.sourceName)}।</p></div>
<table><thead><tr><th>পণ্য</th><th>খুচরা</th><th>খুচরা গড়</th><th>পাইকারি গড়</th><th>নোট</th></tr></thead><tbody>${bodyRows}</tbody></table>`;

  return html(
    layout({
      title,
      description: `${district.bn} জেলার আজকের খুচরা ও পাইকারি বাজারদর।`,
      canonical: `${ctx.origin}/district/${district.slug}`,
      body,
      ctx,
    }),
    ctx,
  );
}

// ── API ─────────────────────────────────────────────────────────────────────

async function apiRoutes(env: Env, ctx: RenderContext, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/$/, "") || "/api";

  if (path === "/api/v1/latest") {
    const districtId = Number(url.searchParams.get("district") ?? 47);
    const rows = await latestForDistrict(env.DB, districtId, 1000);
    return json(
      {
        district_id: districtId,
        date: ctx.latestDate,
        count: rows.length,
        prices: rows.map((r) => ({
          commodity_id: r.commodityId,
          retail: r.retail,
          wholesale: r.wholesale,
          carried_forward: r.carriedForward,
          anomaly: r.anomaly,
        })),
        source: ctx.sourceName,
        licence: `${ctx.origin}/licence`,
      },
      ctx,
    );
  }

  if (path === "/api/v1/price") {
    const commodity = url.searchParams.get("commodity") ?? "";
    const district = url.searchParams.get("district") ?? "";
    const date = url.searchParams.get("date") ?? undefined;
    const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM commodity`).all();
    const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
    // The same resolver the MCP tool uses, so the REST API and the MCP
    // server never disagree about which commodity was meant.
    const commodityList = (cs ?? []).map((x) => {
      const r = x as Record<string, unknown>;
      return { id: Number(r.id), nameBn: String(r.name_bn ?? ""), nameEn: String(r.name_en ?? "") };
    });
    const districtList = (ds ?? []).map((x) => {
      const r = x as Record<string, unknown>;
      return { id: Number(r.id), nameBn: String(r.name_bn ?? ""), nameEn: String(r.name_en ?? "") };
    });
    const cRes = resolve(commodityList, commodity);
    const dRes = resolve(districtList, district);
    const c = cRes.match;
    const d = dRes.match;
    if (!c || !d) return json({ error: "commodity and district are required" }, ctx, 400);    const rows = await latestForDistrict(env.DB, Number(d.id), 1000);
    const row = rows.find((r) => r.commodityId === Number(c.id));
    if (!row) return json({ error: "not found" }, ctx, 404);
    const cSlug = commoditySlug(c.nameBn, c.nameEn, c.id);
    const dSlug = districtSlug(d.nameBn, d.nameEn, d.id);
    return json(
      {
        commodity: { bn: c.nameBn, en: c.nameEn },
        district: { bn: d.nameBn, en: d.nameEn },
        price_date: date ?? row.priceDate,
        retail: row.retail,
        wholesale: row.wholesale,
        carried_forward: row.carriedForward,
        anomaly: row.anomaly,
        canonical_url: factUrl(ctx.origin, cSlug, dSlug, date ?? row.priceDate),
        source: ctx.sourceName,
      },
      ctx,
    );
  }

  if (path === "/api/v1/series.csv") {
    const commodity = Number(url.searchParams.get("commodity"));
    const district = Number(url.searchParams.get("district"));
    if (!commodity || !district) return json({ error: "commodity and district ids are required" }, ctx, 400);
    const since = url.searchParams.get("since") ?? new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const rows = await historyFor(env.DB, commodity, district, since, 400);
    const lines = ["price_date,commodity_id,district_id,retail_min,retail_max,retail_avg,wholesale_min,wholesale_max,wholesale_avg,carried_forward,anomaly"];
    for (const r of rows.slice().reverse()) {
      lines.push(
        [
          r.priceDate,
          r.commodityId,
          r.districtId,
          r.retail?.min ?? "",
          r.retail?.max ?? "",
          r.retail?.avg ?? "",
          r.wholesale?.min ?? "",
          r.wholesale?.max ?? "",
          r.wholesale?.avg ?? "",
          r.carriedForward ? 1 : 0,
          r.anomaly ? `"${r.anomaly.replace(/"/g, '""')}"` : "",
        ].join(","),
      );
    }
    return withCommonHeaders(
      new Response(lines.join("\n"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=600" },
      }),
      ctx,
    );
  }

  if (path === "/api/v1/districts") {
    const { results } = await env.DB.prepare(`SELECT id, name_bn, name_en, division_id FROM district ORDER BY name_bn`).all();
    return json({ count: (results ?? []).length, districts: results, source: ctx.sourceName }, ctx);
  }

  if (path === "/api/v1/commodities") {
    const { results } = await env.DB
      .prepare(`SELECT c.id, c.name_bn, c.name_en, c.group_id, g.name_bn AS group_bn FROM commodity c LEFT JOIN commodity_group g ON g.id=c.group_id ORDER BY g.name_bn, c.name_bn`)
      .all();
    return json({ count: (results ?? []).length, commodities: results, source: ctx.sourceName }, ctx);
  }

  return json({ error: "Not Found", hint: "see /api" }, ctx, 404);
}

// ── Static documents ────────────────────────────────────────────────────────

function robotsTxt(env: Env): Response {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  // Allow the search/RAG indexers (these are the ones that produce citations),
  // block the training crawlers. Each vendor documents these as independent
  // settings, so blocking training does not remove search visibility.
  const body = `# দরদেখা — robots.txt
# সার্চ/সাইটেশন বটগুলোকে অনুমতি (এগুলোই citation তৈরি করে)
User-agent: OAI-SearchBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Googlebot
Allow: /
User-agent: Applebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: Google-Other
Allow: /

# প্রশিক্ষণ-ডেটা বটগুলো বন্ধ (আলাদা সেটিংস, তাই সার্চ দৃশ্যমানতা থাকে)
User-agent: GPTBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: CCBot
Disallow: /
User-agent: Bytespider
Disallow: /
User-agent: Amazonbot
Disallow: /
User-agent: meta-externalagent
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: Applebot-Extended
Disallow: /
User-agent: cohere-ai
Disallow: /

# ব্যবহারকারী-চালিত ফেচার
User-agent: ChatGPT-User
Allow: /
User-agent: Claude-User
Allow: /
User-agent: Perplexity-User
Allow: /

User-agent: *
Disallow: /internal/
Disallow: /api/v1/series.csv
Allow: /

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

function llmsTxt(env: Env): Response {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  const body = `# দরদেখা (Dordekha)

> বাংলাদেশের সরকারি দৈনিক কৃষি বাজারদর, ইউনিট-সংশোধিত ও ধাপে ধাপে যাচাই করা।
> Official Bangladesh daily agricultural market prices, unit-normalised and verified.

## What this is
A daily, machine-readable feed of the Ministry of Agriculture (কৃষি বিপণন অধিদপ্তর, DAM) market price reports:
64 districts, 505 upazilas, 447 commodities, retail and wholesale, with roughly 16 months of history.

## Key pages
- [Dataset and scope](${base}/dataset): what is covered, what is not, and how the numbers are derived.
- [Methodology](${base}/methodology): the unit normalisation and gap handling rules.
- [Licence](${base}/licence): how the data may be used.
- [API reference](${base}/api): REST endpoints and the MCP server.

## Machine interfaces
- MCP server (Streamable HTTP, stateless): \`POST ${base}/mcp\`
  Methods: \`server/discover\`, \`tools/list\`, \`tools/call\`
  Tools: \`get_market_price\`, \`compare_districts\`, \`get_price_trend\`, \`verify_claim\`
- REST: \`GET ${base}/api/v1/latest?district=<id>\`, \`GET ${base}/api/v1/price?commodity=<name>&district=<name>\`
- CSV series: \`GET ${base}/api/v1/series.csv?commodity=<id>&district=<id>\`
- Every page has a \`.md\` and a \`.json\` variant. Content negotiation via \`Accept: text/markdown\` works too.

## Attribution
Please cite as: দরদেখা (${base}), data: কৃষি মন্ত্রণালয় / DAM daily price report.
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

async function sitemap(env: Env, latest: string | null): Promise<Response> {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  const urls: string[] = [`${base}/`, `${base}/price`, `${base}/dataset`, `${base}/methodology`, `${base}/licence`, `${base}/api`];

  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM commodity`).all();
  for (const c of cs ?? []) {
    const r = c as Record<string, unknown>;
    urls.push(`${base}/price/${commoditySlug(String(r.name_bn ?? ""), String(r.name_en ?? ""), Number(r.id))}`);
  }
  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  for (const d of ds ?? []) {
    const r = d as Record<string, unknown>;
    urls.push(`${base}/district/${districtSlug(String(r.name_bn ?? ""), String(r.name_en ?? ""), Number(r.id))}`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

// ── Content documents ───────────────────────────────────────────────────────

async function datasetPage(env: Env, ctx: RenderContext): Promise<Response> {
  const commodityCount = await env.DB.prepare(`SELECT COUNT(*) AS c FROM commodity`).first<{ c: number }>();
  const districtCount = await env.DB.prepare(`SELECT COUNT(*) AS c FROM district`).first<{ c: number }>();
  const upazilaCount = await env.DB.prepare(`SELECT COUNT(*) AS c FROM upazila`).first<{ c: number }>();
  const days = await env.DB.prepare(`SELECT COUNT(DISTINCT price_date) AS c FROM price_daily`).first<{ c: number }>();
  const rows = await env.DB.prepare(`SELECT COUNT(*) AS c FROM price_daily`).first<{ c: number }>();

  const body = `<nav class="crumbs"><a href="/">হোম</a> › ডেটাসেট</nav>
<h1>দরদেখা ডেটাসেট</h1>
<div class="answer">
  <p>বাংলাদেশের কৃষি মন্ত্রণালয়ের (কৃষি বিপণন অধিদপ্তর) প্রতিদিনের অনলাইন বাজারদর রিপোর্ট থেকে তৈরি একটি মেশিন-পড়যোগ্য ডেটাসেট। প্রতিটি সংখ্যা উৎস-তারিখসহ রক্ষিত, ইউনিট সংশোধিত এবং যাঁরা জমা দেননি তাদের জন্য স্পষ্ট চিহ্নিত।</p>
</div>
<section><h2>পরিসংখ্যান</h2>
<table><thead><tr><th>বিষয়</th><th>মান</th></tr></thead><tbody>
<tr><td>পণ্য</td><td class="num">${commodityCount?.c ?? 0}</td></tr>
<tr><td>জেলা</td><td class="num">${districtCount?.c ?? 0}</td></tr>
<tr><td>উপজেলা</td><td class="num">${upazilaCount?.c ?? 0}</td></tr>
<tr><td>প্রতিবেদনের তারিখ</td><td class="num">${days?.c ?? 0}</td></tr>
<tr><td>মোট সারি</td><td class="num">${rows?.c ?? 0}</td></tr>
<tr><td>সর্বশেষ তারিখ</td><td class="num">${esc(ctx.latestDate ?? "—")}</td></tr>
</tbody></table></section>
<section><h2>যা আছে</h2>
<ul>
<li>প্রতিটি পণ্যের খুচরা ও পাইকারি — ন্যূনতম, সর্বোচ্চ ও গড়</li>
<li>জেলা ভিত্তিক তথ্য, এবং উপজেলা ভিত্তিক তথ্য (ক্রমানুসারে যুক্ত হচ্ছে)</li>
<li>প্রায় ১৬ মাসের ইতিহাস</li>
<li>একক করা ইউনিট (পাইকারি মান প্রতি খুচরা-ইউনিটে রূপান্তরিত)</li>
<li>প্রতিটি সারিতে তথ্যের তারিখ, গ্যাপ এবং সতর্কতা-চিহ্ন</li>
</ul></section>
<section><h2>যা নেই</h2>
<ul>
<li>সরকারি রিপোর্টে যেসব জেলা/উপজেলা জমা দেয়নি, সেখানে কোনো মান তৈরি করা হয় না</li>
<li>বাজারের প্রকৃত লেনদেনের দর — এটি সরকারি নজরদারির দর, চুক্তির দর নয়</li>
<li>কোনো অনুমান বা ইন্টারপোলেশন</li>
</ul></section>`;

  const title = "ডেটাসেট — দরদেখা";
  return html(
    layout({
      title,
      description: "বাংলাদেশের সরকারি দৈনিক কৃষি বাজারদর ডেটাসেট: ৬৪ জেলা, ৫০৫ উপজেলা, ৪৪৭ পণ্য, খুচরা ও পাইকারি।",
      canonical: `${ctx.origin}/dataset`,
      body,
      ctx,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "দরদেখা — বাংলাদেশের দৈনিক কৃষি বাজারদর",
        description: "Ministry of Agriculture daily market price reports, unit-normalised and machine-readable.",
        url: `${ctx.origin}/dataset`,
        creator: { "@type": "Organization", name: "দরদেখা" },
        isBasedOn: ctx.sourceName,
        license: `${ctx.origin}/licence`,
        temporalCoverage: "2025-06/ongoing",
        spatialCoverage: "Bangladesh",
        variableMeasured: ["retail price", "wholesale price", "district", "upazila", "commodity"],
      },
    }),
    ctx,
  );
}

async function methodologyPage(env: Env, ctx: RenderContext): Promise<Response> {
  const body = `<nav class="crumbs"><a href="/">হোম</a> › পদ্ধতি</nav>
<h1>পদ্ধতি — কীভাবে সংখ্যা তৈরি হয়</h1>
<div class="answer">
  <p>প্রতিটি সংখ্যা কৃষি মন্ত্রণালয়ের অনলাইন বাজারদর রিপোর্ট থেকে সরাসরি নেওয়া। পার্থক্য শুধু তিনটি: ইউনিট ঠিক করা, ফাঁকা (গ্যাপ) স্পষ্ট করা, এবং পুরোনো মান পুনরায় ব্যবহারের ক্ষেত্রে চিহ্নিত করা।</p>
</div>

<section><h2>১. ইউনিট সংশোধন</h2>
<p>উৎস ডেটায় পাইকারি মানটি প্রকৃত অনুপাতে লেখা নেই। গম ও শস্যে খুচরা মান প্রতি কেজি, আর পাইকারি মান প্রতি ১০০ কেজির জন্য — অথচ সেটিকে "কুইন্টাল" বলা হয়েছে (প্রমাণিত কুইন্টাল ৩৭.৩২ কেজি)। ফলে ৮০ টাকা/কেজি চালের পাইকারি মান ৭২৫০ দেখায়, যা ভুল। সঠিক স্কেল ১০০ দিয়ে ভাগ করলে পাইকারি মান ৭২.৫ টাকা/কেজি হয়, যা খুচরার নিচে — বাস্তবসম্ংত।</p>
<p>প্রতিটি ইউনিট-জোড়ার গুণক লাইভ ডেটা মিলিয়ে বের করা হয়েছে এবং প্রতিটি রেকর্ডে সংরক্ষিত থাকে (উপরে <code>wholesale_divisor</code> ও <code>wholesale_divisor_src</code>)।</p></section>

<section><h2>২. ফাঁকা (গ্যাপ) সৎভাব</h2>
<p>উৎসে কোনো তারিখে কোনো জেলা জমা দেয়নি, সেখানে কোনো সংখ্যা তৈরি করা হয় না। পরের তারিখের প্রতিবেদন দেখিয়ে চলে যায় না — বরং "এই তারিখে তথ্য নেই" বলা হয়।</p></section>

<section><h2>৩. পুরোনো মানের চিহ্ন</h2>
<p>কখনো কখনো উৎস আগের দিনের সংখ্যা হুবহু সরিয়ে দেয়। এমন সারি আলাদা করে চিহ্নিত করা হয়, যাতে পরিবর্তনের গ্রাফ মিথ্যা না দেখায়।</p></section>

<section><h2>৪. যাচাই</h2>
<p>যেকোনো সংখ্যার উৎস-তারিখ ও ইউনিট-গুণক সংরক্ষিত থাকে। ফ্যাক্ট পেজে প্রতিটি দাবির সাথে URL ও JSON রূপ আছে, যা AI সহকারী নিজে টেনে নিতে পারে।</p></section>`;

  const title = "পদ্ধতি — দরদেখা";
  return html(
    layout({
      title,
      description: "দরদেখা কীভাবে সরকারি বাজারদরের সংখ্যা সংশোধন ও যাচাই করে: ইউনিট সংশোধন, গ্যাপ-সততা, পুরোনো মান চিহ্নিতকরণ।",
      canonical: `${ctx.origin}/methodology`,
      body,
      ctx,
    }),
    ctx,
  );
}

async function licencePage(env: Env, ctx: RenderContext): Promise<Response> {
  const body = `<nav class="crumbs"><a href="/">হোম</a> › লাইসেন্স</nav>
<h1>লাইসেন্স ও ব্যবহারের শর্ত</h1>
<div class="answer">
  <p>দরদেখা ডেটা মূলত সরকারি উৎস থেকে নেওয়া। উপরের লাইসেন্সটি আমাদের নিজস্ব প্রক্রিয়াগত অবস্থান — বাণিজ্যিক ব্যবহারের আগে কৃষি বিপণন অধিদপ্তরের সঙ্গে লাইসেন্স/সমচ্ছেদ বিষয়ে যোগাযোগ করা হয়।</p>
</div>
<section><h2>ব্যক্তিগল ও গবেষণার ব্যবহার</h2>
<p>ব্যক্তিগল পরিচয়, গবেষণা, শিক্ষা ও সংবাদ-পত্রের ব্যবহারের জন্য তথ্য নেওয়া ও প্রকাশ করা যায়। উৎস (কৃষি মন্ত্রণালয় / DAM) উল্লেখ করা বাধ্যতামূলক।</p></section>
<section><h2>বাণিজ্যিক ব্যবহার</h2>
<p>বাণিজ্যিক ব্যবহার (অ্যাপ, এন্টারপ্রাইজ ইন্টিগ্রেশন, পুনঃবিতরণ) একটি লাইসেন্সের অধীনে। লাইসেন্সের ধরন: বাণিজ্যিক ব্যবহারের অনুমতি, API, অ্যালার্ট ও বাল্ক ডেটা এক্সপোর্ট।</p>
<pre><code>GET /api/v1/latest?district=47
GET /api/v1/price?commodity=পেঁয়াজ&amp;district=পাবনা
GET /api/v1/series.csv?commodity=602&amp;district=47</code></pre>
<p>যোগাযোগ: <a href="/api">API</a> পাতায় মূল্য ও যোগাযোগের বিবরণ।</p></section>
<section><h2>দায়বশীমতা</h2>
<p>তথ্য সরকারি রিপোর্টের নিবন্ধনের উপর ভিত্তি করে দেওয়া হয়েছে। ভুল ব্যাখ্যা, অসম্পূর্ণ উপস্থাপন, অথবা মূল উৎসের পরিবর্তন ছাড়া ব্যবহার নিষিদ্ধ।</p></section>`;

  const title = "লাইসেন্স — দরদেখা";
  return html(
    layout({
      title,
      description: "দরদেখা ডেটার ব্যবহারের শর্ত: ব্যক্তিগল ও গবেষণার ব্যবহার, এবং বাণিজ্যিক ব্যবহারের লাইসেন্স।",
      canonical: `${ctx.origin}/licence`,
      body,
      ctx,
    }),
    ctx,
  );
}

async function apiDocPage(env: Env, ctx: RenderContext): Promise<Response> {
  const body = `<nav class="crumbs"><a href="/">হোম</a> › API</nav>
<h1>API ও MCP</h1>
<div class="answer">
  <p>দরদেখার তথ্য REST API, CSV এক্সপোর্ট ও MCP server — তিনভাবে পাওয়া যায়। প্রতিটি উত্তরে উৎস, তারিখ ও একটি উদ্ধৃতিযোগ্য URL থাকে।</p>
</div>
<section><h2>REST</h2>
<pre><code>GET /api/v1/latest?district=47
GET /api/v1/price?commodity=পেঁয়াজ&amp;district=পাবনা
GET /api/v1/history?commodity=602&amp;district=47
GET /api/v1/series.csv?commodity=602&amp;district=47
GET /api/v1/districts
GET /api/v1/commodities</code></pre>
<p>দ্রুত পরীক্ষা: <a href="/api/v1/latest?district=47">/api/v1/latest?district=47</a></p></section>
<section><h2>MCP server (stateless)</h2>
<pre><code>POST /mcp
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28

{"jsonrpc":"2.0","id":1,"method":"tools/list"}</code></pre>
<p>টুল: <code>get_market_price</code>, <code>compare_districts</code>, <code>get_price_trend</code>, <code>verify_claim</code>। প্রতিটি ফলাফলে <code>url</code> থাকে, যা অ্যাসিস্ট্যান্টের উত্তরে ক্লিকযোগ্য উৎস হিসেবে দেখায়।</p>
<pre><code>opencode mcp add dordekha --url ${esc(ctx.origin)}/mcp</code></pre>
</section>
<section><h2>বিকল্প ফরম্যাট</h2>
<p>যেকোনো পেজে <code>.md</code> বা <code>.json</code> যোগ করুন, অথবা <code>Accept: text/markdown</code> বা <code>Accept: application/json</code> হেডার পাঠান।</p></section>`;

  const title = "API ও MCP — দরদেখা";
  return html(
    layout({
      title,
      description: "দরদেখার REST API, CSV এক্সপোর্ট ও MCP server — AI সহকারীর জন্য মেশিন-পড়যোগ্য বাজারদর।",
      canonical: `${ctx.origin}/api`,
      body,
      ctx,
    }),
    ctx,
  );
}

async function verifyPage(env: Env, ctx: RenderContext, request: Request, url: URL): Promise<Response> {
  const claim = url.searchParams.get("claim") ?? "";
  if (!claim) {
    const body = `<nav class="crumbs"><a href="/">হোম</a> › যাচাই</nav>
<h1>দাবি যাচাই করুন</h1>
<div class="answer"><p>কোনো দাবি লিখুন — যেমন <code>পেঁয়াজ ৬০ টাকা ঢাকায়</code> — আমরা সরকারি রেকর্ডের সাথে মিলিয়ে দেখাই।</p></div>
<form method="get" action="/verify"><p><input name="claim" value="${esc(claim)}" style="width:min(520px,100%);padding:10px;border:1px solid #dfe6d8;border-radius:8px" placeholder="পেঁয়াজ ৬০ টাকা ঢাকায়"><button style="padding:10px 16px;margin-left:8px;border:0;border-radius:8px;background:#1f6f3f;color:#fff;cursor:pointer">যাচাই</button></p></form>`;
    return html(
      layout({
        title: "দাবি যাচাই — দরদেখা",
        description: "বাংলাদেশের সরকারি বাজারদর রেকর্ডের সাথে আপনার দাবি মিলিয়ে দেখুন।",
        canonical: `${ctx.origin}/verify`,
        body,
        ctx,
      }),
      ctx,
    );
  }

  // Reuse the MCP verification logic through the same code path.
  const { handleMcp } = await import("./mcp");
  const res = await handleMcp(env, ctx, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "verify_claim", arguments: { claim } },
  });
  const payload = (await res.json()) as { result?: { content?: { text?: string }[]; structuredContent?: Record<string, unknown> } };
  const text = payload.result?.content?.[0]?.text ?? "যাচাই করা যায়নি";
  const url2 = (payload.result?.structuredContent?.url as string) ?? "";

  const body = `<nav class="crumbs"><a href="/">হোম</a> › যাচাই</nav>
<h1>দাবি যাচাই</h1>
<div class="answer">
  <p><strong>দাবি:</strong> ${esc(claim)}</p>
  <pre style="background:#f2f5ee;color:#16210f"><code>${esc(text)}</code></pre>
  ${url2 ? `<p><a href="${esc(url2)}">উৎস পাতা</a></p>` : ""}
</div>
<form method="get" action="/verify"><p><input name="claim" value="${esc(claim)}" style="width:min(520px,100%);padding:10px;border:1px solid #dfe6d8;border-radius:8px"><button style="padding:10px 16px;margin-left:8px;border:0;border-radius:8px;background:#1f6f3f;color:#fff;cursor:pointer">পুনরায় যাচাই</button></p></form>`;

  return html(
    layout({
      title: `যাচাই: ${claim} — দরদেখা`,
      description: `দাবি "${claim}" সরকারি বাজারদর রেকর্ডের সাথে মিলিয়ে দেখা হয়েছে।`,
      canonical: `${ctx.origin}/verify?claim=${encodeURIComponent(claim)}`,
      body,
      ctx,
    }),
    ctx,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function unitLookup(env: Env): Promise<Map<number | null, string>> {
  const { results } = await env.DB.prepare(`SELECT id, name_bn FROM unit`).all();
  const map = new Map<number | null, string>();
  for (const u of results ?? []) {
    const r = u as Record<string, unknown>;
    map.set(Number(r.id), String(r.name_bn ?? "কেজি"));
  }
  return map;
}

async function notFound(env: Env, ctx: RenderContext): Promise<Response> {
  const body = `<h1>৪০৪ — পাতা পাওয়া যায়নি</h1>
<div class="answer"><p>এই পাতাটি নেই। <a href="/">হোমে</a> ফিরে যান বা <a href="/price">পণ্যের তালিকা</a> দেখুন।</p></div>`;
  return html(
    layout({
      title: "৪০৪ — দরদেখা",
      description: "পাতা পাওয়া যায়নি।",
      canonical: `${ctx.origin}/404`,
      body,
      ctx,
    }),
    ctx,
    404,
  );
}

void toAsciiNumber;
