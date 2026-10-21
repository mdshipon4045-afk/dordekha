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
  busiestDistrict,
  carriedShare,
  commodityCoverage,
  historyFor,
  ingestHealth,
  latestDate,
  latestForCommodity,
  latestForDistrict,
  ledgerRows,
  movers,
  siteStats,
} from "./db";
import { formatBdt } from "./normalize";
import { extractKeywords, foldForCompare } from "./bn";
import { candidatesFor, pickByCoverage } from "./resolve";
import { refreshMaster, startIngest, stepIngest, buildDigestInput, cronTick } from "./ingest";
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
import {
  renderApiHtml,
  renderDatasetHtml,
  renderLicenceHtml,
  renderMethodologyHtml,
  renderNotFoundHtml,
  renderPriceIndexHtml,
  renderVerifyHtml,
  type PriceIndexItem,
} from "./pages";
import { commoditySlug, districtSlug } from "./slug";
import type { Env } from "./types";

const MD = "text/markdown; charset=utf-8";
const JSON_T = "application/json; charset=utf-8";
const HTML = "text/html; charset=utf-8";

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
        return json({ ok: fresh && (h.rowsToday ?? 0) > 0, ...h }, ctxR, fresh ? 200 : 503);
      }

      if (path.startsWith("/internal/")) {
        const token = env.ADMIN_TOKEN;
        const provided = request.headers.get("X-Admin-Token") ?? url.searchParams.get("token");
        if (token && provided !== token) {
          return json({ error: "Forbidden" }, ctxR, 403);
        }
        if (path === "/internal/ingest/start") {
          return json({ started: true, job: await startIngest(env) }, ctxR);
        }
        if (path === "/internal/ingest/step") {
          return json({ job: await stepIngest(env) }, ctxR);
        }
        if (path === "/internal/ingest/tick") {
          return json(await cronTick(env), ctxR);
        }
        if (path === "/internal/master/refresh") {
          return json({ refreshed: true, ...(await refreshMaster(env)) }, ctxR);
        }
        if (path === "/internal/telegram/check") {
          const { checkTelegram, telegramConfig } = await import("./telegram");
          const config = telegramConfig(env);
          if (!config) return json({ ok: false, error: "Telegram is not configured" }, ctxR, 400);
          return json(await checkTelegram(config), ctxR);
        }
        if (path === "/internal/telegram/test") {
          const { publishDigest } = await import("./telegram");
          const res = await publishDigest(env, {
            date: ctxR.latestDate ?? new Date().toISOString().slice(0, 10),
            rows: [
              {
                commodityBn: "পেঁয়াজ",
                districtBn: "ঢাকা",
                retail: { min: 43, max: 47, avg: 45, unitBn: "কিলোগ্রাম" },
                wholesale: { avg: 38 },
                carriedForward: false,
              },
            ],
            origin: ctxR.origin,
            sourceName: ctxR.sourceName,
            featured: ["পেঁয়াজ"],
          });
          return json(res, ctxR, res.sent ? 200 : 500);
        }
        if (path === "/internal/telegram/digest") {
          const { publishDigest } = await import("./telegram");
          const res = await publishDigest(
            env,
            await buildDigestInput(env, ctxR.latestDate ?? new Date().toISOString().slice(0, 10)),
          );
          return json(res, ctxR, res.sent ? 200 : 500);
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
    // The cron runs every minute. Each tick either continues the ingest job
    // or starts a new one when one is due. There is no self-call: a Worker
    // cannot reliably call itself in production, and the job position lives
    // in D1 so a lost tick costs one minute, not the whole run.
    ctx.waitUntil(
      (async () => {
        try {
          const result = await cronTick(env);
          if (result.action !== "idle") console.log(`cron tick: ${result.action}`);
        } catch (err) {
          console.error("cron tick failed", err);
        }
      })(),
    );
  },
};

// ── Page handlers ───────────────────────────────────────────────────────────

async function homePage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  const [district, stats, carried, moveRows] = await Promise.all([
    busiestDistrict(env.DB),
    siteStats(env.DB),
    carriedShare(env.DB),
    movers(env.DB, 6),
  ]);

  const rows = await ledgerRows(env.DB, district.id, 16);
  const ledger = rows.map((r) => ({
    commodityBn: r.commodityBn,
    commodityEn: r.commodityEn,
    commoditySlug: r.commoditySlug,
    districtBn: r.districtBn,
    districtSlug: r.districtSlug,
    retail: r.retail,
    wholesale: r.wholesale,
    carriedForward: r.carriedForward,
    date: r.date,
    url: factUrl(ctx.origin, r.commoditySlug, r.districtSlug, r.date),
  }));

  const data = {
    latestDate: ctx.latestDate,
    previousDate: null,
    ledger,
    movers: moveRows.map((m) => ({
      commodityBn: m.commodityBn,
      districtBn: m.districtBn,
      now: m.now,
      was: m.was,
      changePct: m.changePct,
    })),
    carriedPct: carried,
    commodityCount: stats.commodities,
    districtCount: stats.districts,
    rowCount: stats.rows,
    dayCount: stats.days,
  };

  if (fmt === "markdown") return md(renderHomeMarkdown(data, ctx), ctx);
  if (fmt === "json") {
    return json({ ...data, source: ctx.sourceName, canonical_url: `${ctx.origin}/` }, ctx);
  }
  return html(renderHomeHtml(data, ctx), ctx);
}

async function priceIndex(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  const { results: cs } = await env.DB
    .prepare(
      `SELECT c.id, c.name_bn, c.name_en, c.group_id, g.name_bn AS group_bn,
              p.retail_avg, p.retail_unit
         FROM commodity c
         LEFT JOIN commodity_group g ON g.id = c.group_id
         LEFT JOIN price_latest p ON p.commodity_id = c.id AND p.district_id = 47 AND p.upazila_id = 0
        ORDER BY g.name_bn, c.name_bn`,
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
  });

  if (fmt === "json") return json({ count: items.length, commodities: items, source: ctx.sourceName }, ctx);
  if (fmt === "markdown") {
    const lines = ["# পণ্যতালিকা — দরদেখা", "", `মোট ${items.length}টি পণ্য।`, ""];
    for (const i of items) lines.push(`- [${i.bn}](/price/${i.slug}) — ${i.group}`);
    return md(lines.join("\n"), ctx);
  }
  return html(renderPriceIndexHtml(items, ctx), ctx);
}

async function pricePage(
  env: Env,
  ctx: RenderContext,
  fmt: Format,
  commoditySlugParam: string,
  districtSlugParam: string | null,
  date: string | null,
): Promise<Response> {
  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en, group_id FROM commodity`).all();
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
  for (const g of gs ?? []) {
    groups.set(Number((g as Record<string, unknown>).id), String((g as Record<string, unknown>).name_bn ?? ""));
  }

  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  const districts = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: districtSlug(bn, en, Number(r.id)) };
  });

  if (!districtSlugParam) {
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
        groupBn:
          groups.get(
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
    };

    if (fmt === "json") {
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
    if (fmt === "markdown") return md(renderCommodityMarkdown(data, ctx), ctx);
    return html(renderCommodityHtml(data, ctx), ctx);
  }

  const district = districts.find((d) => d.slug === districtSlugParam);
  if (!district) return notFound(env, ctx);

  const rows = await latestForDistrict(env.DB, district.id, 1000);
  const row = rows.find((r) => r.commodityId === commodity.id);
  if (!row) return notFound(env, ctx);

  const { results: us } = await env.DB.prepare(`SELECT id, name_bn FROM unit`).all();
  const unitMap = new Map<number, string>();
  for (const u of us ?? []) {
    unitMap.set(Number((u as Record<string, unknown>).id), String((u as Record<string, unknown>).name_bn ?? "কেজি"));
  }

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
      unitBn: unitMap.get(row.retail?.unit ?? 0) ?? "কেজি",
      unitEn: unitMap.get(row.retail?.unit ?? 0) ?? "kg",
    },
    wholesale: row.wholesale
      ? {
          min: row.wholesale.min,
          max: row.wholesale.max,
          avg: row.wholesale.avg,
          unitBn: unitMap.get(row.wholesale.unit ?? 0) ?? "কেজি",
          unitEn: unitMap.get(row.wholesale.unit ?? 0) ?? "kg",
        }
      : null,
    url: factUrl(ctx.origin, commodity.slug, district.slug, date ?? row.priceDate),
    carriedForward: row.carriedForward,
    anomaly: row.anomaly,
  };

  if (fmt === "json") return json(renderPriceFactJson(fact, ctx), ctx);
  if (fmt === "markdown") return md(renderPriceFactMarkdown(fact, ctx), ctx);
  return html(renderPriceFactHtml(fact, ctx), ctx);
}

async function districtPage(env: Env, ctx: RenderContext, request: Request, slug: string): Promise<Response> {
  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  const districts = (ds ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    return { id: Number(r.id), bn, en, slug: districtSlug(bn, en, Number(r.id)) };
  });
  const district = districts.find((d) => d.slug === slug);
  if (!district) return notFound(env, ctx);

  const rows = await latestForDistrict(env.DB, district.id, 1000);
  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM commodity`).all();
  const commodityById = new Map<number, { bn: string; slug: string }>();
  for (const c of cs ?? []) {
    const r = c as Record<string, unknown>;
    const bn = String(r.name_bn ?? "");
    const en = String(r.name_en ?? "");
    commodityById.set(Number(r.id), { bn, slug: commoditySlug(bn, en, Number(r.id)) });
  }

  const items: PriceIndexItem[] = rows
    .filter((r) => r.retail?.avg != null)
    .map((r) => {
      const c = commodityById.get(r.commodityId);
      return {
        bn: c?.bn ?? String(r.commodityId),
        en: "",
        group: "",
        slug: c?.slug ?? String(r.commodityId),
        retailAvg: r.retail?.avg ?? null,
        unitBn: "কেজি",
      };
    });

  if (request.headers.get("accept")?.includes("application/json")) {
    return json(
      {
        district: { bn: district.bn, en: district.en, id: district.id },
        date: ctx.latestDate,
        prices: rows.map((r) => ({
          commodity_id: r.commodityId,
          retail: r.retail,
          wholesale: r.wholesale,
          carried_forward: r.carriedForward,
        })),
        source: ctx.sourceName,
      },
      ctx,
    );
  }

  const bodyRows = items
    .map(
      (i) => `<tr>
      <td class="c-item"><a href="/price/${esc(i.slug)}/${esc(district.slug)}">${esc(i.bn)}</a></td>
      <td class="n">${esc(formatBdt(i.retailAvg))}</td>
      <td class="c-prov">${esc(i.unitBn)}</td>
    </tr>`,
    )
    .join("\n");

  return html(
    layout({
      title: `${district.bn} জেলার আজকের বাজারদর — দরদেখা`,
      description: `${district.bn} জেলার আজকের খুচরা ও পাইকারি বাজারদর।`,
      canonical: `${ctx.origin}/district/${district.slug}`,
      body: `<section class="band" style="border-bottom:0">
  <div class="shell">
    <div class="eyebrow"><span class="dot"></span> জেলা অনুযায়ী আজকের খাতা</div>
    <h1 style="font-size:clamp(30px,4.8vw,46px)">${esc(district.bn)} জেলার বাজারদর</h1>
    <p class="lead">${esc(district.bn)} জেলায় ${items.length}টি পণ্যের সরকারি বাজারদর সর্বশেষ প্রতিবেদনে পাওয়া গেছে। উৎস: ${esc(ctx.sourceName)}।</p>
    <div class="sheet" style="margin-top:26px">
      <div class="sheet-bar"><span>পণ্য</span><span>${esc(ctx.latestDate ?? "")}</span></div>
      <table class="ledger">
        <thead><tr><th>পণ্য</th><th class="n">গড় খুচরা দর</th><th>একক</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>
</section>`,
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

  if (path === "/api/v1/search") {
    const found = await searchFact(env, ctx, url.searchParams.get("q") ?? "");
    return json(found, ctx, found.error ? 404 : 200);
  }

  if (path === "/api/v1/price") {
    const found = await searchFact(env, ctx, url.searchParams.get("q") ?? "", {
      commodity: url.searchParams.get("commodity") ?? "",
      district: url.searchParams.get("district") ?? "",
    });
    return json(found, ctx, found.error ? 404 : 200);
  }

  if (path === "/api/v1/series.csv") {
    const commodity = Number(url.searchParams.get("commodity"));
    const district = Number(url.searchParams.get("district"));
    if (!commodity || !district) return json({ error: "commodity and district ids are required" }, ctx, 400);
    const since =
      url.searchParams.get("since") ?? new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const rows = await historyFor(env.DB, commodity, district, since, 400);
    const lines = [
      "price_date,commodity_id,district_id,retail_min,retail_max,retail_avg,wholesale_min,wholesale_max,wholesale_avg,carried_forward,anomaly",
    ];
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
    const { results } = await env.DB
      .prepare(`SELECT id, name_bn, name_en, division_id FROM district ORDER BY name_bn`)
      .all();
    return json({ count: (results ?? []).length, districts: results, source: ctx.sourceName }, ctx);
  }

  if (path === "/api/v1/commodities") {
    const { results } = await env.DB
      .prepare(
        `SELECT c.id, c.name_bn, c.name_en, c.group_id, g.name_bn AS group_bn FROM commodity c LEFT JOIN commodity_group g ON g.id=c.group_id ORDER BY g.name_bn, c.name_bn`,
      )
      .all();
    return json({ count: (results ?? []).length, commodities: results, source: ctx.sourceName }, ctx);
  }

  return json({ error: "Not Found", hint: "see /api" }, ctx, 404);
}

/**
 * Resolve a free-text query to a single price fact.
 *
 * This backs the home page's live search as well as /api/v1/search, so a
 * human typing "পেঁয়াজ ঢাকা" and an agent calling the API get the same
 * answer.
 */
async function searchFact(
  env: Env,
  ctx: RenderContext,
  q: string,
  explicit?: { commodity: string; district: string },
): Promise<Record<string, unknown>> {
  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM commodity`).all();
  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();

  const commodityList = (cs ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return { id: Number(row.id), nameBn: String(row.name_bn ?? ""), nameEn: String(row.name_en ?? "") };
  });
  const districtList = (ds ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return { id: Number(row.id), nameBn: String(row.name_bn ?? ""), nameEn: String(row.name_en ?? "") };
  });

  // ── Work out what the user is asking about ──────────────────────────────
  const keywords = extractKeywords(q);
  const commodityCandidates = explicit?.commodity
    ? candidatesFor(commodityList, [explicit.commodity])
    : candidatesFor(commodityList, keywords);
  const districtCandidates = explicit?.district
    ? candidatesFor(districtList, [explicit.district])
    : candidatesFor(districtList, keywords);

  if (commodityCandidates.length === 0) {
    return {
      error: `No commodity matched "${explicit?.commodity || q}". Try the Bangla or English name, e.g. পেঁয়াজ বা potato.`,
    };
  }

  // ── Pick the district first, so coverage can be judged against it ───────
  const district = districtCandidates.length ? pickByCoverage(districtCandidates).match : null;

  // ── Pick the commodity ────────────────────────────────────────────────
  // Two rules, in order:
  //  1. it must actually be reported — a variety with no rows is never the
  //     right answer ("চাল" matches 27 varieties, most with no Dhaka row);
  //  2. among the ones that are reported, the one reported in the most
  //     districts wins, so "চাল" means rice rather than "চালকুমড়া".
  const districtRows = district ? await latestForDistrict(env.DB, district.id, 1000) : [];
  const present = new Set(districtRows.map((r) => r.commodityId));
  const viable = district
    ? commodityCandidates.filter((c) => present.has(c.id))
    : commodityCandidates;
  const globalCoverage = await commodityCoverage(
    env.DB,
    commodityCandidates.map((c) => c.id),
  );
  const ranked = [...viable].sort((a, b) => {
    // A name that *starts* with the keyword is the one the user meant:
    // "চাল" is "চাল - আমন - সরু", not "চিনিগুড়া চাল".
    const aStarts = startsWithKeyword(a.nameBn, keywords);
    const bStarts = startsWithKeyword(b.nameBn, keywords);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    // Then the most generic name: "আলু" should mean the common potato, not
    // "আলু (হল্যান্ড) - সাদা", a seed variety.
    if (a.nameBn.length !== b.nameBn.length) return a.nameBn.length - b.nameBn.length;
    // Then the one reported in the most districts.
    const ca = globalCoverage.get(a.id) ?? 0;
    const cb = globalCoverage.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.id - b.id;
  });
  const picked = {
    match: ranked[0] ?? commodityCandidates[0]!,
    alternatives: ranked.slice(1, 5),
  };
  const commodity = picked.match;
  const cSlug = commoditySlug(commodity.nameBn, commodity.nameEn, commodity.id);

  if (district) {
    const row = districtRows.find((r) => r.commodityId === commodity.id);
    if (!row || !row.retail) {
      return {
        error: `No published price for ${commodity.nameBn} in ${district.nameBn} on ${ctx.latestDate ?? "the latest report date"}.`,
      };
    }
    const dSlug = districtSlug(district.nameBn, district.nameEn, district.id);
    return {
      commodity: { name_bn: commodity.nameBn, name_en: commodity.nameEn },
      district: { name_bn: district.nameBn, name_en: district.nameEn },
      price_date: row.priceDate,
      retail: row.retail,
      wholesale: row.wholesale,
      prices: { retail: row.retail, wholesale: row.wholesale },
      carried_forward: row.carriedForward,
      anomaly: row.anomaly,
      ambiguous: commodityCandidates.length > 1,
      alternatives: { commodities: picked.alternatives.map((a) => a.nameBn), districts: [] },
      canonical_url: factUrl(ctx.origin, cSlug, dSlug, row.priceDate),
      source: { name: ctx.sourceName },
      licence: `${ctx.origin}/licence`,
    };
  }

  // ── No district in the query: answer with the national picture ─────────
  const all = await latestForCommodity(env.DB, commodity.id, 200);
  const withRetail = all
    .map((r) => ({ r, avg: r.retail?.avg }))
    .filter((x): x is { r: (typeof all)[number]; avg: number } => typeof x.avg === "number");
  if (withRetail.length === 0) {
    return { error: `No published price for ${commodity.nameBn} yet.` };
  }
  const avgs = withRetail.map((x) => x.avg).sort((a, b) => a - b);
  // A median and percentiles rather than a min/max: the upstream
  // occasionally carries a row that is off by two orders of magnitude
  // (2275 BDT/kg for onion), and one bad row must not define the range.
  const median = quantile(avgs, 0.5);
  const low = quantile(avgs, 0.1);
  const high = quantile(avgs, 0.9);
  const outliers = avgs.filter((v) => v > median * 3 || (median > 0 && v < median / 3)).length;
  const avg = avgs.reduce((s, v) => s + v, 0) / avgs.length;
  const cheapest = withRetail.find((x) => x.avg === avgs[0])!;
  const dearest = withRetail.find((x) => x.avg === avgs[avgs.length - 1])!;
  const unit = withRetail[0]?.r.retail?.unit ?? null;
  const { results: unitRows } = await env.DB.prepare(`SELECT id, name_bn FROM unit`).all();
  const unitMap = new Map<number, string>();
  for (const u of unitRows ?? []) {
    unitMap.set(
      Number((u as Record<string, unknown>).id),
      String((u as Record<string, unknown>).name_bn ?? "কেজি"),
    );
  }

  return {
    commodity: { name_bn: commodity.nameBn, name_en: commodity.nameEn },
    district: { name_bn: "জেলা-গড়", name_en: "national average" },
    price_date: ctx.latestDate,
    scope: "national",
    retail: {
      min: Math.round(low * 100) / 100,
      max: Math.round(high * 100) / 100,
      avg: Math.round(median * 100) / 100,
      unit: unit ?? 2,
      unit_bn: unitMap.get(unit ?? 2) ?? "কেজি",
    },
    mean: Math.round(avg * 100) / 100,
    outliers_excluded: outliers,
    wholesale: null,
    prices: { retail: null, wholesale: null },
    carried_forward: false,
    anomaly: null,
    ambiguous: commodityCandidates.length > 1,
    alternatives: { commodities: picked.alternatives.map((a) => a.nameBn), districts: [] },
    cheapest_district: cheapest.r.districtId,
    dearest_district: dearest.r.districtId,
    districts_reporting: withRetail.length,
    canonical_url: `${ctx.origin}/price/${cSlug}`,
    source: { name: ctx.sourceName },
    licence: `${ctx.origin}/licence`,
  };
}

/** Does the name begin with one of the keywords? */
function startsWithKeyword(name: string, keywords: string[]): boolean {
  const n = foldForCompare(name);
  return keywords.some((k) => {
    const key = foldForCompare(k);
    return key.length >= 2 && n.startsWith(key);
  });
}

// ── Static documents ────────────────────────────────────────────────────────

/** The q-th quantile of a sorted array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function robotsTxt(env: Env): Response {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
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
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
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
- Free-text search: \`GET ${base}/api/v1/search?q=পেঁয়াজ ঢাকা\`
- CSV series: \`GET ${base}/api/v1/series.csv?commodity=<id>&district=<id>\`
- Every page has a \`.md\` and a \`.json\` variant. Content negotiation via \`Accept: text/markdown\` works too.

## Attribution
Please cite as: দরদেখা (${base}), data: কৃষি মন্ত্রণালয় / DAM daily price report.
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

async function sitemap(env: Env, latest: string | null): Promise<Response> {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  const urls: string[] = [
    `${base}/`,
    `${base}/price`,
    `${base}/dataset`,
    `${base}/methodology`,
    `${base}/licence`,
    `${base}/api`,
    `${base}/verify`,
  ];

  const { results: cs } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM commodity`).all();
  for (const c of cs ?? []) {
    const r = c as Record<string, unknown>;
    urls.push(
      `${base}/price/${commoditySlug(String(r.name_bn ?? ""), String(r.name_en ?? ""), Number(r.id))}`,
    );
  }
  const { results: ds } = await env.DB.prepare(`SELECT id, name_bn, name_en FROM district`).all();
  for (const d of ds ?? []) {
    const r = d as Record<string, unknown>;
    urls.push(
      `${base}/district/${districtSlug(String(r.name_bn ?? ""), String(r.name_en ?? ""), Number(r.id))}`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

// ── Content documents ───────────────────────────────────────────────────────

async function datasetPage(env: Env, ctx: RenderContext): Promise<Response> {
  const stats = await siteStats(env.DB);
  const upazilas = await env.DB.prepare(`SELECT COUNT(*) AS c FROM upazila`).first<{ c: number }>();
  return html(renderDatasetHtml({ ...stats, upazilas: upazilas?.c ?? 0 }, ctx), ctx);
}

async function methodologyPage(env: Env, ctx: RenderContext): Promise<Response> {
  return html(renderMethodologyHtml(ctx), ctx);
}

async function licencePage(env: Env, ctx: RenderContext): Promise<Response> {
  return html(renderLicenceHtml(ctx), ctx);
}

async function apiDocPage(env: Env, ctx: RenderContext): Promise<Response> {
  return html(renderApiHtml(ctx), ctx);
}

async function verifyPage(
  env: Env,
  ctx: RenderContext,
  request: Request,
  url: URL,
): Promise<Response> {
  const claim = url.searchParams.get("claim") ?? "";
  if (!claim) {
    return html(renderVerifyHtml("", { ok: false, text: "", url: null, actual: null }, ctx), ctx);
  }

  const { handleMcp } = await import("./mcp");
  const res = await handleMcp(env, ctx, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "verify_claim", arguments: { claim } },
  });
  const payload = (await res.json()) as {
    result?: { content?: { text?: string }[]; structuredContent?: Record<string, unknown> };
  };
  const text = payload.result?.content?.[0]?.text ?? "";
  const verdictUrl = (payload.result?.structuredContent?.url as string) ?? null;
  const verdict = text.includes("মিলেছে");

  return html(
    renderVerifyHtml(claim, { ok: verdict, text, url: verdictUrl, actual: null }, ctx),
    ctx,
  );
}

async function notFound(env: Env, ctx: RenderContext): Promise<Response> {
  return html(renderNotFoundHtml(ctx), ctx, 404);
}
