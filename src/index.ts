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
  commodityCoverageOrSnapshot,
  commodityRefs,
  districtRefs,
  historyForOrSnapshot,
  ingestHealth,
  latestForCommodityOrSnapshot,
  latestForDistrictOrSnapshot,
  ledgerRowsOrSnapshot,
  moversOrSnapshot,
  priceForDateOrSnapshot,
  resolveFact,
  unitNames,
} from "./db";
import {
  getAggregates,
  getSnapshot,
  refreshAggregates,
  setAggregates,
  setHistorySnapshot,
  setMasterSnapshot,
  setSnapshot,
  writeSnapshot,
} from "./cache";
import { formatBdt } from "./normalize";
import { extractKeywords, foldForCompare } from "./bn";
import { candidatesFor, pickByCoverage, resolve } from "./resolve";
import { refreshMaster, startIngest, stepIngest, buildDigestInput, cronTick } from "./ingest";
import { ensureSchema, maintenanceState } from "./maintenance";
import {
  currentPeriod,
  disableLicense,
  enforceAccess,
  issueLicense,
  keyFromRequest,
  listLicenses,
  planLimits,
  verifyLicense,
  LicenceError,
} from "./keys";
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
  renderNotFoundHtml,
  renderNoDataHtml,
  renderPriceIndexHtml,
  renderVerifyHtml,
  type PriceIndexItem,
} from "./pages";
import { commoditySlug, districtSlug } from "./slug";
import { allUnits } from "./units";
import {
  apiDoc,
  datasetDoc,
  licenceDoc,
  methodologyDoc,
  pricingDoc,
  renderDocHtml,
  renderDocJson,
  renderDocMarkdown,
  type DatasetStats,
  type Doc,
} from "./docs";
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

    try {
      // Inside the try: a failed lookup must produce a readable error, not an
      // empty 500 from the platform. The aggregates are cached in KV, so the
      // common case does not touch the database at all.
      const aggregates = await getAggregates(env);
      const latest = aggregates.latestDate;
      const ctxR = ctxFor(env, latest);      // ── MCP ────────────────────────────────────────────────────────────
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
        const access = await enforceAccess(env, request, "/mcp", "mcp");
        if (!access.ok) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: access.reason ?? "Forbidden" },
            }),
            { status: access.status, headers: { "content-type": "application/json" } },
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
        // Public: only what a monitor needs, and it must not depend on the
        // database being readable — the aggregates are cached.
        const agg = await getAggregates(env);
        const fresh =
          agg.latestDate !== null && Date.now() - new Date(agg.latestDate).getTime() < 5 * 86_400_000;
        return json(
          { ok: fresh && agg.rowCount > 0, latest_date: agg.latestDate, rows: agg.rowCount },
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
        if (path === "/internal/health") {
          return json(
            { ...(await ingestHealth(env.DB)), maintenance: await maintenanceState(env) },
            ctxR,
          );
        }
        if (path === "/internal/maintenance") {
          const result = await ensureSchema(env);
          return json(result, ctxR);
        }
        if (path === "/internal/license/create" && request.method === "POST") {
          try {
            const body = (await request.json()) as {
              plan?: string;
              label?: string;
              contact?: string;
              months?: number;
            };
            const issued = await issueLicense(env, {
              plan: body.plan ?? "free",
              label: body.label,
              contact: body.contact,
              months: body.months,
            });
            // The raw key is in this response and nowhere else. It is shown
            // once, because only its hash is stored.
            return json(issued, ctxR);
          } catch (err) {
            if (err instanceof LicenceError) {
              return json({ error: err.message }, ctxR, err.status);
            }
            throw err;
          }
        }
        if (path === "/internal/license/list") {
          return json({ licenses: await listLicenses(env) }, ctxR);
        }
        if (path === "/internal/license/disable" && request.method === "POST") {
          const body = (await request.json()) as { id?: string };
          if (!body.id) return json({ error: "id is required" }, ctxR, 400);
          return json({ disabled: await disableLicense(env, body.id) }, ctxR);
        }
        if (path === "/internal/snapshot") {
          // Write the current prices and the daily aggregates to KV, so the
          // site keeps serving when the database's read budget runs out.
          const n = await writeSnapshot(env);
          await refreshAggregates(env);
          return json({ snapshot_rows: n, refreshed: true }, ctxR);
        }
        if (path === "/internal/snapshot-upload") {
          // A snapshot built from a database export, used when the database
          // itself cannot be read.
          const payload = (await request.json()) as {
            snapshot?: { at: string; date: string | null; rows: unknown[] };
            aggregates?: Record<string, unknown>;
            master?: unknown;
            history?: { rows: unknown[] };
          };
          if (payload.snapshot?.rows) {
            await setSnapshot(env, payload.snapshot as never);
          }
          if (payload.aggregates) {
            await setAggregates(env, payload.aggregates as never);
          }
          if (payload.master) {
            await setMasterSnapshot(env, payload.master as never);
          }
          if (payload.history?.rows) {
            await setHistorySnapshot(env, payload.history.rows as never);
          }
          return json(
            {
              ok: true,
              rows: payload.snapshot?.rows?.length ?? 0,
              history: payload.history?.rows?.length ?? 0,
            },
            ctxR,
          );
        }
        if (path === "/internal/telegram/check") {          const { checkTelegram, telegramConfig } = await import("./telegram");
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
      if (path.startsWith("/sitemap-")) {
        const part = await sitemapPart(env, path.slice("/sitemap-".length), latest);
        return part ?? json({ error: "Not Found" }, ctxR, 404);
      }
      if (path === "/openapi.json") return openApi(env, ctxR);

      // ── API ────────────────────────────────────────────────────────────
      if (path === "/api/v1/account") return accountRoute(env, ctxR, request);
      if (path.startsWith("/api/")) {
        const access = await enforceAccess(env, request, path, "api");
        if (!access.ok) {
          return json({ error: access.reason ?? "Forbidden", status: access.status }, ctxR, access.status);
        }
        return apiRoutes(env, ctxR, url);
      }

      // ── Pages ──────────────────────────────────────────────────────────
      if (path === "/") return homePage(env, ctxR, fmt, aggregates);
      if (path === "/price") return priceIndex(env, ctxR, fmt);
      if (path === "/dataset") return datasetPage(env, ctxR, fmt);
      if (path === "/methodology") return methodologyPage(env, ctxR, fmt);
      if (path === "/licence") return licencePage(env, ctxR, fmt);
      if (path === "/api") return apiDocPage(env, ctxR, fmt);
      if (path === "/pricing") return pricingPage(env, ctxR, fmt);
      if (path === "/verify") return verifyPage(env, ctxR, request, url, fmt);

      const priceMatch = /^\/price\/([^/]+)(?:\/([^/]+))?(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(path);
      if (priceMatch) {
        return pricePage(env, ctxR, fmt, priceMatch[1]!, priceMatch[2] ?? null, priceMatch[3] ?? null);
      }

      const districtMatch = /^\/district\/([^/]+)$/.exec(path);
      if (districtMatch) return districtPage(env, ctxR, request, districtMatch[1]!, fmt);

      return notFound(env, ctxR, fmt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The detail is logged, not published. The audit found the raw D1
      // error in the response body — the free-tier quota, the vendor's
      // internal message, the plan name. An assistant reads that and
      // concludes the service is finished, rather than that it is busy.
      console.error("request failed", url.pathname, message, err instanceof Error ? err.stack : "");
      const fallback = ctxFor(env, null);
      return json(
        {
          error: "Service temporarily unavailable",
          status: "degraded",
          message:
            "এই মুহূর্তে তথ্য দেওয়া যাচ্ছে না। সাময়িক সমস্যা হলে কিছুক্ষণ পরে আবার চেষ্টা করুন।",
          retry_after_seconds: 60,
          path: url.pathname,
        },
        fallback,
        503,
      );
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The daily upkeep: the worker applies its own indexes once the D1 read
    // quota has reset, and refreshes the master data so the cached snapshot
    // stops being older than the database.
    if (event.cron === "2 0 * * *") {
      ctx.waitUntil(
        (async () => {
          try {
            const result = await ensureSchema(env);
            if (result.created.length > 0) console.log(`maintenance: created ${result.created.join(", ")}`);
            if (result.columnsAdded.length > 0) {
              console.log(`maintenance: added ${result.columnsAdded.join(", ")}`);
            }
            if (result.failed.length > 0) console.error(`maintenance: failed ${result.failed.join("; ")}`);
          } catch (err) {
            console.error("maintenance failed", err);
          }
          try {
            const master = await refreshMaster(env);
            console.log(`maintenance: master refreshed (${master.commodities} commodities)`);
          } catch (err) {
            console.error("master refresh failed", err);
          }
        })(),
      );
      return;
    }

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

async function homePage(
  env: Env,
  ctx: RenderContext,
  fmt: Format,
  aggregates: {
    busiestDistrictId: number;
    busiestDistrictName: string;
    commodityCount: number;
    commoditiesWithData: number;
    districtCount: number;
    rowCount: number;
    days: number;
    carriedPct: number | null;
  },
): Promise<Response> {
  const [district, stats, carried, moveRows] = await Promise.all([
    Promise.resolve({ id: aggregates.busiestDistrictId, nameBn: aggregates.busiestDistrictName }),
    Promise.resolve({
      commodities: aggregates.commodityCount,
      districts: aggregates.districtCount,
      rows: aggregates.rowCount,
      days: aggregates.days,
    }),
    Promise.resolve(aggregates.carriedPct),
    // From the cache where possible: this is the most visited page, and it
    // must not spend the database's daily read budget.
    moversOrSnapshot(env, 6).catch(() => []),
  ]);

  // The ledger sheet is a nicety; if neither the cache nor the database can
  // be read right now, the page still renders with the rest of it.
  const rows = await ledgerRowsOrSnapshot(env, district.id, 16).catch(() => []);
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
    ledgerDistrict: district.nameBn,
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
    commoditiesWithData: aggregates.commoditiesWithData,
    districtCount: stats.districts,
    rowCount: stats.rows,
    dayCount: stats.days,
  };

  if (fmt === "markdown") return md(renderHomeMarkdown(data, ctx), ctx);
  if (fmt === "json") {
    return json({ ...data, source: SOURCE, canonical_url: `${ctx.origin}/` }, ctx);
  }
  return html(renderHomeHtml(data, ctx), ctx);
}

async function priceIndex(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  const refs = await commodityRefs(env);
  const dhaka = await latestForDistrictOrSnapshot(env, 47, 1000);
  const byCommodity = new Map(dhaka.map((r) => [r.commodityId, r.retail?.avg ?? null]));

  const items: PriceIndexItem[] = refs.map((c) => ({
    bn: c.nameBn,
    en: c.nameEn,
    group: c.groupBn,
    slug: commoditySlug(c.nameBn, c.nameEn, c.id),
    retailAvg: byCommodity.get(c.id) ?? null,
    unitBn: "কেজি",
  }));

  if (fmt === "json") return json({ count: items.length, commodities: items, source: SOURCE }, ctx);
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
  const commodities = (await commodityRefs(env)).map((c) => ({
    id: c.id,
    bn: c.nameBn,
    en: c.nameEn,
    groupId: c.groupId,
    groupBn: c.groupBn,
    slug: commoditySlug(c.nameBn, c.nameEn, c.id),
  }));
  const commodity = commodities.find((c) => c.slug === commoditySlugParam);
  if (!commodity) return notFound(env, ctx, fmt);



  const districts = (await districtRefs(env)).map((d) => ({
    id: d.id,
    bn: d.nameBn,
    en: d.nameEn,
    slug: districtSlug(d.nameBn, d.nameEn, d.id),
  }));

  if (!districtSlugParam) {
    const rows = await latestForCommodityOrSnapshot(env, commodity.id, 200);
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
    const hist = await historyForOrSnapshot(env, commodity.id, 47, since, 60);

    const data: CommodityPageData = {
      commodity: {
        id: commodity.id,
        bn: commodity.bn,
        en: commodity.en,
        slug: commodity.slug,
        groupBn: commodity.groupBn,
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
          source: SOURCE,
        },
        ctx,
      );
    }
    if (fmt === "markdown") return md(renderCommodityMarkdown(data, ctx), ctx);
    return html(renderCommodityHtml(data, ctx), ctx);
  }

  const district = districts.find((d) => d.slug === districtSlugParam);
  if (!district) return notFound(env, ctx, fmt);

  // A requested date is looked up in the history. It is never inferred from
  // the latest snapshot: a page for 1 August must not carry 17 October's
  // figures under an August date.
  const row = date
    ? await priceForDateOrSnapshot(env, commodity.id, district.id, date)
    : (await latestForDistrictOrSnapshot(env, district.id, 1000)).find((r) => r.commodityId === commodity.id);

  if (!row) {
    if (date) {
      // Point the reader (or the assistant) at the dates that do exist.
      const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
      const hist = await historyForOrSnapshot(env, commodity.id, district.id, since, 400);
      const available = hist
        .map((h) => ({
          date: h.priceDate,
          url: factUrl(ctx.origin, commodity.slug, district.slug, h.priceDate),
        }))
        .filter((h) => h.date !== date)
        .slice(0, 30);
      return html(
        renderNoDataHtml(
          { commodity: commodity.bn, district: district.bn, date, available, latest: ctx.latestDate },
          ctx,
        ),
        ctx,
        404,
      );
    }
    return notFound(env, ctx, fmt);
  }

  const unitMap = await unitNames(env);

  const fact: PriceFact = {
    commodityBn: commodity.bn,
    commodityEn: commodity.en,
    districtBn: district.bn,
    districtEn: district.en,
    date: row.priceDate,
    retail: {
      min: row.retail?.min ?? null,
      max: row.retail?.max ?? null,
      avg: row.retail?.avg ?? null,
      unitBn: unitMap.get(row.retail?.unit ?? 0) ?? "কেজি",
      unitEn: unitMap.get(row.retail?.unit ?? 0) ?? "kg",
      isMidpoint: row.retail?.isMidpoint ?? false,
    },
    wholesale: row.wholesale
      ? {
          min: row.wholesale.min,
          max: row.wholesale.max,
          avg: row.wholesale.avg,
          // The wholesale figure has been divided down to the retail unit, so
          // the retail unit is the only honest label for it.
          unitBn: unitMap.get(row.wholesale.unit ?? row.retail?.unit ?? 0) ?? "কেজি",
          unitEn: unitMap.get(row.wholesale.unit ?? row.retail?.unit ?? 0) ?? "kg",
          isMidpoint: row.wholesale.isMidpoint,
        }
      : null,
    url: factUrl(ctx.origin, commodity.slug, district.slug, row.priceDate),
    carriedForward: row.carriedForward,
    anomaly: row.anomaly,
  };

  if (fmt === "json") return json(renderPriceFactJson(fact, ctx), ctx);
  if (fmt === "markdown") return md(renderPriceFactMarkdown(fact, ctx), ctx);
  return html(renderPriceFactHtml(fact, ctx), ctx);
}

async function districtPage(
  env: Env,
  ctx: RenderContext,
  request: Request,
  slug: string,
  fmt: Format,
): Promise<Response> {
  const districts = (await districtRefs(env)).map((d) => ({
    id: d.id,
    bn: d.nameBn,
    en: d.nameEn,
    slug: districtSlug(d.nameBn, d.nameEn, d.id),
  }));
  const district = districts.find((d) => d.slug === slug);
  if (!district) return notFound(env, ctx, fmt);

  const rows = await latestForDistrictOrSnapshot(env, district.id, 1000);
  const commodityById = new Map<number, { bn: string; slug: string }>();
  for (const c of await commodityRefs(env)) {
    commodityById.set(c.id, { bn: c.nameBn, slug: commoditySlug(c.nameBn, c.nameEn, c.id) });
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
        source: SOURCE,
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

/** Where the figures came from, for a reader who wants to follow the citation. */
const SOURCE = {
  name: "কৃষি মন্ত্রণালয় / কৃষি বিপণন অধিদপ্তর (DAM)",
  url: "https://market.dam.gov.bd/market_daily_price_report",
  api: "https://moa-services.com/agri-service",
} as const;

/**
 * Resolve a district from an id or a name.
 *
 * Accepting only an id is a trap for an assistant that has just read the
 * name off a web page: `district=ঢাকা` becomes NaN and the endpoint
 * answers with an empty result, which reads as "Dhaka has no prices".
 */
async function resolveDistrictParam(
  env: Env,
  raw: string,
): Promise<{ id: number; name: string; nameEn: string } | null> {
  const list = await districtRefs(env);
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const hit = list.find((d) => d.id === asNumber);
    return hit ? { id: hit.id, name: hit.nameBn, nameEn: hit.nameEn } : null;
  }
  const hit = resolve(list, raw).match;
  return hit ? { id: hit.id, name: hit.nameBn, nameEn: hit.nameEn } : null;
}

/** The English name of a unit id, for the unit legend. */
function unitNameEn(id: number): string {
  return allUnits().find((u) => u.id === id)?.en ?? "kg";
}

/**
 * The key holder's own view: which plan, how much has been used, until when.
 *
 * The key is never echoed back — only its hash is stored, so there is
 * nothing to echo.
 */
async function accountRoute(env: Env, ctx: RenderContext, request: Request): Promise<Response> {
  const key = keyFromRequest(request);
  if (!key) {
    return json({ error: "একটি API key দিন (X-API-Key বা Authorization: Bearer)।" }, ctx, 401);
  }
  const licence = await verifyLicense(env, key);
  if (!licence) return json({ error: "API key চেনা যায়নি।" }, ctx, 401);

  const limits = planLimits(licence.plan);
  const period = currentPeriod();
  const used = licence.period === period ? licence.callsUsed : 0;
  return json(
    {
      id: licence.id,
      plan: licence.plan,
      label: licence.label,
      contact: licence.contact,
      created_at: licence.createdAt,
      expires_at: licence.expiresAt,
      active: licence.active,
      period,
      calls_used: used,
      calls_limit: licence.callsLimit,
      burst_limit: limits.burstLimit,
      commercial_use: licence.plan !== "free",
    },
    ctx,
  );
}

async function apiRoutes(env: Env, ctx: RenderContext, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/$/, "") || "/api";

  if (path === "/api/v1/latest") {
    // The district is required. The audit found that omitting it silently
    // returned Dhaka — the largest market in the country — so an assistant
    // that forgot the parameter would confidently quote the wrong district.
    const raw = url.searchParams.get("district");
    if (!raw) {
      return json(
        {
          error: "district is required",
          hint: "Use the district id (e.g. 47) or its name (e.g. ঢাকা, Dhaka).",
          districts: `${ctx.origin}/api/v1/districts`,
        },
        ctx,
        400,
      );
    }
    const district = await resolveDistrictParam(env, raw);
    if (!district) {
      return json(
        {
          error: `Unknown district "${raw}"`,
          hint: "Use the district id (e.g. 47) or its name (e.g. ঢাকা, Dhaka).",
          districts: `${ctx.origin}/api/v1/districts`,
        },
        ctx,
        400,
      );
    }
    const rows = await latestForDistrictOrSnapshot(env, district.id, 1000);
    const unitMap = await unitNames(env);
    const commodities = await commodityRefs(env);
    const nameOf = new Map(commodities.map((c) => [c.id, c.nameBn]));
    const slugOf = new Map(
      commodities.map((c) => [c.id, commoditySlug(c.nameBn, c.nameEn, c.id)]),
    );
    const districtSlugValue = districtSlug(district.name, district.nameEn, district.id);
    const commodityById = new Map(commodities.map((c) => [c.id, c]));

    return json(
      {
        district_id: district.id,
        district: district.name,
        date: ctx.latestDate,
        count: rows.length,
        prices: rows.map((r) => {
          const c = commodityById.get(r.commodityId);
          const unit = unitMap.get(r.retail?.unit ?? 0) ?? "কেজি";
          return {
            commodity_id: r.commodityId,
            commodity: c ? { name_bn: c.nameBn, name_en: c.nameEn } : null,
            retail: r.retail
              ? {
                  min: r.retail.min,
                  max: r.retail.max,
                  avg: r.retail.avg,
                  unit: r.retail.unit,
                  unit_bn: unit,
                  is_midpoint: r.retail.isMidpoint,
                }
              : null,
            wholesale: r.wholesale
              ? {
                  min: r.wholesale.min,
                  max: r.wholesale.max,
                  avg: r.wholesale.avg,
                  unit: r.wholesale.unit,
                  unit_bn: unit,
                  is_midpoint: r.wholesale.isMidpoint,
                  divisor: r.wholesale.divisor,
                  divisor_source: r.wholesale.divisorSource,
                }
              : null,
            price_date: r.priceDate,
            carried_forward: r.carriedForward,
            anomaly: r.anomaly,
            // The permalink that shows this exact figure.
            url: c
              ? factUrl(ctx.origin, slugOf.get(r.commodityId)!, districtSlugValue, r.priceDate)
              : null,
          };
        }),
        source: SOURCE,
        licence: `${ctx.origin}/licence`,
      },
      ctx,
    );
  }

  if (path === "/api/v1/units") {
    // The unit legend. The audit found that the REST API handed out bare
    // numbers — `unit: 2` — with nothing anywhere saying what 2 meant, so
    // a consumer had to guess "kg" and could be wrong.
    const list = await unitNames(env);
    const rows = [...list.entries()]
      .map(([id, nameBn]) => ({ id, name_bn: nameBn, name_en: unitNameEn(id) }))
      .sort((a, b) => a.id - b.id);
    return json(
      {
        count: rows.length,
        note: "unit is the id of the unit the retail price is expressed in. Wholesale prices are divided down to the same unit.",
        units: rows,
        source: SOURCE,
      },
      ctx,
    );
  }

  if (path === "/api/v1/search") {
    const found = await searchFact(env, ctx, url.searchParams.get("q") ?? "");
    return json(found, ctx, found.error ? 404 : 200);
  }

  if (path === "/api/v1/answer") {
    // Built for assistants. One small, self-contained object: the answer, the
    // date it describes, the source, and a citation string that can be
    // pasted as-is. The point is to make citing us the *easy* option.
    const found = await searchFact(env, ctx, url.searchParams.get("q") ?? "");
    if (found.error) {
      return json(
        {
          answer: null,
          error: found.error,
          source: SOURCE,
          citation: `দরদেখা (${ctx.origin}) — তথ্য পাওয়া যায়নি`,
        },
        ctx,
        404,
      );
    }
    const asOf = String(found.price_date ?? ctx.latestDate ?? "");
    const scope = found.scope === "national" ? "জেলা-গড়" : String((found.district as { name_bn?: string })?.name_bn ?? "");
    const unit = String((found.retail as { unit_bn?: string })?.unit_bn ?? "কেজি");
    const min = (found.retail as { min?: number | null })?.min;
    const max = (found.retail as { max?: number | null })?.max;
    const avg = (found.retail as { avg?: number | null })?.avg;
    const commodity = String((found.commodity as { name_bn?: string })?.name_bn ?? "");
    const priceText =
      min !== null && max !== null && min !== max
        ? `${min}–${max} টাকা/${unit}`
        : `${avg} টাকা/${unit}`;
    const wholesale = (found.wholesale as { avg?: number | null })?.avg;

    const answerText =
      found.scope === "national"
        ? `${commodity} — জেলা-গড় খুচরা দর ${priceText} (গড় ${avg})।`
        : `${commodity} — ${scope} জেলায় খুচরা দর ${priceText}${wholesale != null ? `, পাইকারি ${wholesale} টাকা/${unit}` : ""}।`;

    return json(
      {
        answer: answerText,
        commodity,
        scope: found.scope ?? "district",
        district: scope,
        price_date: asOf,
        retail: found.retail,
        wholesale: found.wholesale ?? null,
        carried_forward: found.carried_forward ?? false,
        url: found.canonical_url,
        source: SOURCE,
        citation: `সূত্র: দরদেখা (${found.canonical_url}), তথ্যের তারিখ: ${asOf}, উৎস: কৃষি মন্ত্রণালয় / DAM।`,
        licence: `${ctx.origin}/licence`,
      },
      ctx,
    );
  }

  if (path === "/api/v1/price") {
    // The date parameter is honoured. The audit found that a request for a
    // specific date silently returned the latest one, so an assistant
    // asking about Tuesday was handed Monday's price with a Monday label.
    const date = url.searchParams.get("date");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: `date must be YYYY-MM-DD, got "${date}"` }, ctx, 400);
    }
    const found = await searchFact(env, ctx, url.searchParams.get("q") ?? "", {
      commodity: url.searchParams.get("commodity") ?? "",
      district: url.searchParams.get("district") ?? "",
      date,
    });
    return json(found, ctx, found.error ? 404 : 200);
  }

  if (path === "/api/v1/series.csv") {
    const commodity = Number(url.searchParams.get("commodity"));
    const district = Number(url.searchParams.get("district"));
    if (!commodity || !district) return json({ error: "commodity and district ids are required" }, ctx, 400);
    const since =
      url.searchParams.get("since") ?? new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const rows = await historyForOrSnapshot(env, commodity, district, since, 400);
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
    const list = await districtRefs(env);
    return json({ count: list.length, districts: list, source: SOURCE }, ctx);
  }

  if (path === "/api/v1/commodities") {
    const list = await commodityRefs(env);
    return json({ count: list.length, commodities: list, source: SOURCE }, ctx);
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
  explicit?: { commodity: string; district: string; date?: string | null },
): Promise<Record<string, unknown>> {
  const commodityList = await commodityRefs(env);
  const districtList = await districtRefs(env);

  // ── Work out what the user is asking about ──────────────────────────────
  const keywords = extractKeywords(q);
  const queryWords = questionWords(keywords);

  // An explicit id is answered with that exact item. An assistant that
  // read "commodity=833" off a previous answer should not be told "no
  // commodity matched 833".
  const explicitCommodityId = explicit?.commodity ? Number(explicit.commodity) : NaN;
  const explicitDistrictId = explicit?.district ? Number(explicit.district) : NaN;

  const commodityCandidates =
    Number.isInteger(explicitCommodityId) && explicitCommodityId > 0
      ? commodityList.filter((c) => c.id === explicitCommodityId)
      : explicit?.commodity
        ? candidatesFor(commodityList, [explicit.commodity])
        : candidatesFor(commodityList, keywords);
  const districtCandidates =
    Number.isInteger(explicitDistrictId) && explicitDistrictId > 0
      ? districtList.filter((d) => d.id === explicitDistrictId)
      : explicit?.district
        ? candidatesFor(districtList, [explicit.district])
        : candidatesFor(districtList, keywords);

  if (commodityCandidates.length === 0) {
    return {
      error: `No commodity matched "${explicit?.commodity || q}". Try the Bangla or English name (e.g. পেঁয়াজ / potato) or the commodity id.`,
      hint: `${ctx.origin}/api/v1/commodities`,
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
  const districtRows = district ? await latestForDistrictOrSnapshot(env, district.id, 1000) : [];
  const rowByCommodity = new Map(districtRows.map((r) => [r.commodityId, r]));
  // A commodity that has no price in this district can never be the right
  // answer, however well its name matches.
  const withPrice = commodityCandidates.filter(
    (c) => rowByCommodity.get(c.id)?.retail?.avg != null,
  );
  const present = new Set(districtRows.map((r) => r.commodityId));
  const viable = district
    ? withPrice.length
      ? withPrice
      : commodityCandidates.filter((c) => present.has(c.id))
    : commodityCandidates;
  const globalCoverage = await commodityCoverageOrSnapshot(
    env,
    commodityCandidates.map((c) => c.id),
  );
  const ranked = [...viable].sort((a, b) => {
    // A candidate that names everything the question names is the one that
    // was meant: "সয়াবিন তেল" is the oil, not the seed.
    const aCovers = coversAllWords(a.nameBn, queryWords);
    const bCovers = coversAllWords(b.nameBn, queryWords);
    if (aCovers !== bCovers) return aCovers ? -1 : 1;
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
  const unitMap = await unitNames(env);

  if (district) {
    // One function decides the date and reads the row for it, so the API
    // and the HTML page can never disagree about what "now" means.
    const row = await resolveFact(env, commodity.id, district.id, explicit?.date ?? null);
    if (!row || !row.retail) {
      return {
        error: explicit?.date
          ? `No published price for ${commodity.nameBn} in ${district.nameBn} on ${explicit.date}. The source has no figure for that district and day.`
          : `No published price for ${commodity.nameBn} in ${district.nameBn} on ${ctx.latestDate ?? "the latest report date"}.`,
        ...(explicit?.date ? { available_dates_hint: `${ctx.origin}/price/${cSlug}/${districtSlug(district.nameBn, district.nameEn, district.id)}` } : {}),
      };
    }
    const dSlug = districtSlug(district.nameBn, district.nameEn, district.id);
    return {
      commodity: { name_bn: commodity.nameBn, name_en: commodity.nameEn },
      district: { name_bn: district.nameBn, name_en: district.nameEn },
      price_date: row.priceDate,
      retail: {
        ...row.retail,
        unit_bn: unitMap.get(row.retail.unit ?? 0) ?? "কেজি",
      },
      wholesale: row.wholesale
        ? { ...row.wholesale, unit_bn: unitMap.get(row.wholesale.unit ?? 0) ?? "কেজি" }
        : null,
      prices: { retail: row.retail, wholesale: row.wholesale },
      carried_forward: row.carriedForward,
      anomaly: row.anomaly,
      ambiguous: commodityCandidates.length > 1,
      alternatives: { commodities: picked.alternatives.map((a) => a.nameBn), districts: [] },
      canonical_url: factUrl(ctx.origin, cSlug, dSlug, row.priceDate),
      source: SOURCE,
      licence: `${ctx.origin}/licence`,
    };
  }

  // ── No district in the query: answer with the national picture ─────────
  const all = await latestForCommodityOrSnapshot(env, commodity.id, 200);
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
  const mean = avgs.reduce((s, v) => s + v, 0) / avgs.length;
  const cheapest = withRetail.find((x) => x.avg === avgs[0])!;
  const dearest = withRetail.find((x) => x.avg === avgs[avgs.length - 1])!;
  const unit = withRetail[0]?.r.retail?.unit ?? null;
  // The date the figures are from — the rows' own date, not the day the
  // request happened to arrive.
  const nationalDate = withRetail
    .map((x) => x.r.priceDate)
    .sort()
    .pop() ?? ctx.latestDate;

  return {
    commodity: { name_bn: commodity.nameBn, name_en: commodity.nameEn },
    district: { name_bn: "জেলা-গড়", name_en: "national average" },
    price_date: nationalDate,
    scope: "national",
    retail: {
      min: Math.round(low * 100) / 100,
      max: Math.round(high * 100) / 100,
      // The median across the districts that reported. This one really is
      // a median, not the source's mid-range estimate.
      avg: Math.round(median * 100) / 100,
      median: Math.round(median * 100) / 100,
      unit: unit ?? 2,
      unit_bn: unitMap.get(unit ?? 2) ?? "কেজি",
      is_midpoint: false,
    },
    mean: Math.round(mean * 100) / 100,
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
    source: SOURCE,
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

/** The distinct words of the question that could name a product. */
function questionWords(keywords: string[]): string[] {
  const out = new Set<string>();
  for (const k of keywords) {
    for (const w of foldForCompare(k).split(/[^\p{L}\p{N}\p{M}]+/u)) {
      if (w.length > 1) out.add(w);
    }
  }
  return [...out];
}

/** Does the name contain every word of the question? */
function coversAllWords(name: string, words: string[]): boolean {
  if (words.length < 2) return false;
  const own = foldForCompare(name).split(/[^\p{L}\p{N}\p{M}]+/u);
  return words.every((w) => own.includes(w));
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

async function llmsTxt(env: Env): Promise<Response> {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  // The claim about how much history we hold is computed, not asserted. A
  // stale "16 months" in this file would be a lie the moment the database
  // fell behind.
  const agg = await getAggregates(env);
  const coverage = agg.days
    ? `${agg.firstDate} থেকে ${agg.latestDate} (${agg.days}টি প্রতিবেদনের তারিখ)`
    : "এখনো কোনো তারিখ নেই";

  const body = `# দরদেখা (Dordekha)

> বাংলাদেশের সরকারি দৈনিক কৃষি বাজারদর, ইউনিট-সংশোধিত ও ধাপে ধাপে যাচাই করা।
> Official Bangladesh daily agricultural market prices, unit-normalised and verified.

## What this is
A daily, machine-readable feed of the Ministry of Agriculture (কৃষি বিপণন অধিদপ্তর, DAM) market price reports:
${agg.districtCount} districts, ${agg.commodityCount} commodities in the catalogue, retail and wholesale.
${agg.commoditiesWithData} of the ${agg.commodityCount} catalogued commodities have published prices.
${agg.districtsWithData} of the ${agg.districtCount} districts submitted figures on ${agg.latestDate ?? "the latest day"}.
Upazila-level data: ${agg.upazilaCount > 0 ? `${agg.upazilaCount} upazilas` : "not yet available"}.

**History currently held: ${coverage}.**
The upstream archive reaches further back, but this service publishes only what it has
actually collected and normalised. Ask for a date it does not hold and it will say so
rather than substitute a different day.

**Units.** Retail prices are in the commodity's own unit (usually 1 kg, sometimes 4 pieces
or 1 piece) — the \`unit\` field carries the unit id, and \`/api/v1/units\` gives the legend.
Wholesale prices are divided down to the *same* retail unit, so the two are directly
comparable. The upstream's own unit and the divisor applied are recorded on every row
(\`divisor\`, \`divisor_source\`); the factor is never a hard-coded constant.

**What "avg" is.** The source's third figure is, in 99% of rows, exactly (min + max) / 2 —
a mid-range estimate, not a mean over the markets that reported. Rows therefore carry
\`is_midpoint: true\`, and the range (min–max) is the figure to quote. Where the source's
figure fell outside its own range, the row is clamped, flagged in \`anomaly\`, and the
source's original value is kept in \`source_avg\`.

**Honesty rules.** Where the source has no figure for a place and day, there is no figure
here. Where the upstream repeated the previous day's number, the row is stamped
"পূর্বের" (carried forward). Where a value could not be reconciled, the row is stamped
"সতর্কতা" and the raw divisor is published alongside.

**Citing.** Cite the permalink, not the government form: the DAM report page is a
search form, not a permalink, and a reader cannot find the number there. Every result
carries a \`url\` of the form \`${base}/price/<commodity>/<district>/<date>\` where the
figure is on the page. Always give the data date. Do not write "today" — give the date.

## Key pages
- [Dataset and scope](${base}/dataset): what is covered, what is not, and how the numbers are derived.
- [Methodology](${base}/methodology): the unit normalisation and gap handling rules.
- [Licence](${base}/licence): how the data may be used.
- [Pricing](${base}/pricing): what the free part is, and what the paid services cost.
- [API reference](${base}/api): REST endpoints and the MCP server.
- [OpenAPI spec](${base}/openapi.json): the machine-readable contract.

## Machine interfaces
- MCP server (Streamable HTTP, stateless): \`POST ${base}/mcp\`
  Methods: \`server/discover\`, \`tools/list\`, \`tools/call\`
  Tools: \`get_market_price\`, \`compare_districts\`, \`get_price_trend\`, \`verify_claim\`
- REST: \`GET ${base}/api/v1/latest?district=47\`, \`GET ${base}/api/v1/price?commodity=<name>&district=<name>\`
- Free-text search: \`GET ${base}/api/v1/search?q=পেঁয়াজ ঢাকা\`
- Answer endpoint (built for assistants, one object with a ready citation): \`GET ${base}/api/v1/answer?q=পেঁয়াজ ঢাকা\`
- CSV series: \`GET ${base}/api/v1/series.csv?commodity=<id>&district=<id>\`
- Unit legend: \`GET ${base}/api/v1/units\`
- Every page has a \`.md\` and a \`.json\` variant. Content negotiation via \`Accept: text/markdown\` works too.
- Verify a claim: \`GET ${base}/verify?claim=পেঁয়াজ ৬০ টাকা ঢাকায়\`

## Source
কৃষি মন্ত্রণালয় / কৃষি বিপণন অধিদপ্তর (DAM) — the daily online market price report.
Public report form: https://market.dam.gov.bd/market_daily_price_report

## Attribution
Please cite as: দরদেখা (${base}), data: কৃষি মন্ত্রণালয় / DAM daily price report.
Always give the data date. Do not write "today" — give the date.
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
}

/**
 * The sitemap.
 *
 * The product's whole proposition is a citable, date-specific URL. The audit
 * found 518 URLs in the sitemap and not one of them carried a date — so
 * every per-fact page was invisible to a crawler, and the 48,500 URLs the
 * service can actually produce were advertised nowhere.
 *
 * The fact URLs live in their own sitemaps, split so that no single file
 * gets unwieldy, and the index points at them.
 */
async function sitemap(env: Env, latest: string | null): Promise<Response> {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  const staticUrls: string[] = [
    `${base}/`,
    `${base}/price`,
    `${base}/dataset`,
    `${base}/methodology`,
    `${base}/licence`,
    `${base}/pricing`,
    `${base}/api`,
    `${base}/verify`,
  ];

  const commodities = await commodityRefs(env);
  const districts = await districtRefs(env);
  const commoditySlugById = new Map(
    commodities.map((c) => [c.id, commoditySlug(c.nameBn, c.nameEn, c.id)]),
  );
  const districtSlugById = new Map(
    districts.map((d) => [d.id, districtSlug(d.nameBn, d.nameEn, d.id)]),
  );

  // Only the districts that actually have figures are listed. A sitemap full
  // of empty pages teaches a crawler that this site is full of dead ends.
  const snapshot = await getSnapshot(env);
  const districtsWithData = new Set<number>();
  const factUrls: string[] = [];
  for (const r of snapshot?.rows ?? []) {
    districtsWithData.add(r.d);
    const cs = commoditySlugById.get(r.c);
    const ds = districtSlugById.get(r.d);
    if (cs && ds) factUrls.push(`${base}/price/${cs}/${ds}/${r.t}`);
  }

  const commodityUrls = commodities.map((c) => `${base}/price/${commoditySlug(c.nameBn, c.nameEn, c.id)}`);
  const districtUrls = [...districtsWithData]
    .map((d) => districtSlugById.get(d))
    .filter((s): s is string => Boolean(s))
    .map((s) => `${base}/district/${s}`);

  const CHUNK = 5000;
  const chunks: string[] = [];
  for (let i = 0; i < factUrls.length; i += CHUNK) {
    chunks.push(`${base}/sitemap-facts-${Math.floor(i / CHUNK) + 1}.xml`);
  }

  const index = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${esc(`${base}/sitemap-pages.xml`)}</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</sitemap>
  <sitemap><loc>${esc(`${base}/sitemap-commodities.xml`)}</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</sitemap>
  <sitemap><loc>${esc(`${base}/sitemap-districts.xml`)}</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</sitemap>
  ${chunks.map((c) => `<sitemap><loc>${esc(c)}</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}</sitemap>`).join("\n  ")}
</sitemapindex>`;

  return new Response(index, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/** One part of the sitemap: the pages, the commodities, the districts, or the facts. */
async function sitemapPart(
  env: Env,
  part: string,
  latest: string | null,
): Promise<Response | null> {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  // The part name arrives as "facts-1.xml"; the number has to be read
  // without the suffix, or the slice is NaN and the file is empty.
  const name = part.replace(/\.xml$/, "");
  const commodities = await commodityRefs(env);
  const districts = await districtRefs(env);
  const commoditySlugById = new Map(
    commodities.map((c) => [c.id, commoditySlug(c.nameBn, c.nameEn, c.id)]),
  );
  const districtSlugById = new Map(
    districts.map((d) => [d.id, districtSlug(d.nameBn, d.nameEn, d.id)]),
  );

  let urls: string[] = [];
  let lastmod: string | null = null;

  if (name === "pages") {
    urls = [
      `${base}/`,
      `${base}/price`,
      `${base}/dataset`,
      `${base}/methodology`,
      `${base}/licence`,
      `${base}/pricing`,
      `${base}/api`,
      `${base}/verify`,
    ];
    lastmod = latest;
  } else if (name === "commodities") {
    urls = commodities.map((c) => `${base}/price/${commoditySlug(c.nameBn, c.nameEn, c.id)}`);
    lastmod = latest;
  } else if (name === "districts") {
    const snapshot = await getSnapshot(env);
    const withData = new Set((snapshot?.rows ?? []).map((r) => r.d));
    urls = [...withData]
      .map((d) => districtSlugById.get(d))
      .filter((s): s is string => Boolean(s))
      .map((s) => `${base}/district/${s}`);
    lastmod = latest;
  } else if (name.startsWith("facts-")) {
    const n = Number(name.slice("facts-".length));
    const snapshot = await getSnapshot(env);
    const CHUNK = 5000;
    const all: string[] = [];
    for (const r of snapshot?.rows ?? []) {
      const cs = commoditySlugById.get(r.c);
      const ds = districtSlugById.get(r.d);
      if (cs && ds) all.push(`${base}/price/${cs}/${ds}/${r.t}`);
    }
    urls = all.slice((n - 1) * CHUNK, n * CHUNK);
    lastmod = latest;
  } else {
    return null;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/**
 * An OpenAPI description of the REST endpoints.
 *
 * The audit found that an assistant checking the API had no machine-
 * readable contract to read — it had to guess the parameter names. A
 * spec costs one cached response and saves every consumer a guess.
 */
function openApi(env: Env, ctx: RenderContext): Response {
  const base = env.SITE_ORIGIN.replace(/\/$/, "");
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "দরদেখা — বাংলাদেশের দৈনিক কৃষি বাজারদর",
      version: "1.0.0",
      description:
        "Official daily retail and wholesale market prices for Bangladesh's agricultural commodities, unit-normalised and gap-honest. Every figure carries its source date and a citable URL. Where the source published a mid-range figure rather than a mean, `is_midpoint` is true.",
      license: { name: "দরদেখা লাইসেন্স", url: `${base}/licence` },
    },
    servers: [{ url: base, description: "দরদেখা" }],
    tags: [
      { name: "prices", description: "দৈনিক বাজারদর" },
      { name: "reference", description: "পণ্য, জেলা ও এককের তালিকা" },
    ],
    paths: {
      "/api/v1/latest": {
        get: {
          tags: ["prices"],
          summary: "একটি জেলার সব পণ্যের সর্বশেষ দর",
          parameters: [
            {
              name: "district",
              in: "query",
              required: true,
              description: "জেলার আইডি (যেমন 47) বা নাম (যেমন ঢাকা, Dhaka)",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "সর্বশেষ প্রতিবেদনের সারি",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": { description: "জেলা দেওয়া হয়নি বা অজানা" },
          },
        },
      },
      "/api/v1/price": {
        get: {
          tags: ["prices"],
          summary: "একটি পণ্যের নির্দিষ্ট জেলা ও তারিখের দর",
          parameters: [
            { name: "commodity", in: "query", schema: { type: "string" }, description: "পণ্যের নাম" },
            { name: "district", in: "query", schema: { type: "string" }, description: "জেলার নাম" },
            {
              name: "date",
              in: "query",
              schema: { type: "string", format: "date" },
              description: "YYYY-MM-DD। না দিলে সর্বশেষ প্রতিবেদনের তারিখ।",
            },
          ],
          responses: {
            "200": { description: "একটি তথ্য" },
            "404": { description: "এই তারিখে উৎসে তথ্য নেই" },
          },
        },
      },
      "/api/v1/search": {
        get: {
          tags: ["prices"],
          summary: "ফ্রি-টেক্সটে খুঁজে একটি তথ্য",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "একটি তথ্য" }, "404": { description: "কিছু মেলেনি" } },
        },
      },
      "/api/v1/answer": {
        get: {
          tags: ["prices"],
          summary: "উত্তর + উদ্ধৃতি — অ্যাসিস্ট্যান্টের জন্য",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "উত্তর, তারিখ, উৎস ও উদ্ধৃতি" } },
        },
      },
      "/api/v1/series.csv": {
        get: {
          tags: ["prices"],
          summary: "একটি পণ্যের দৈনিক ইতিহাস (CSV)",
          parameters: [
            { name: "commodity", in: "query", required: true, schema: { type: "integer" } },
            { name: "district", in: "query", required: true, schema: { type: "integer" } },
            { name: "since", in: "query", schema: { type: "string", format: "date" } },
          ],
          responses: { "200": { description: "CSV", content: { "text/csv": {} } } },
        },
      },
      "/api/v1/districts": {
        get: { tags: ["reference"], summary: "জেলার তালিকা", responses: { "200": { description: "জেলা" } } },
      },
      "/api/v1/commodities": {
        get: { tags: ["reference"], summary: "পণ্যের তালিকা", responses: { "200": { description: "পণ্য" } } },
      },
      "/api/v1/units": {
        get: {
          tags: ["reference"],
          summary: "একক কোডের সংজ্ঞা",
          responses: { "200": { description: "unit কোড ও তার নাম" } },
        },
      },
    },
  };
  return json(spec, ctx);
}

// ── Content documents ───────────────────────────────────────────────────────

/**
 * The numbers the content pages state.
 *
 * Every one of them is counted from the data at request time. The audit
 * found the dataset page claiming "505 upazilas" against a table with none,
 * a JSON-LD block promising sixteen months of history against three days
 * of data, and two different carry-forward rates on two different pages.
 * A number that is written into the copy is a number that goes stale and
 * gets repeated back.
 */
async function datasetStats(env: Env): Promise<DatasetStats> {
  const agg = await getAggregates(env);
  const unitMap = await unitNames(env);
  const units = [...unitMap.entries()]
    .map(([id, nameBn]) => ({ id, nameBn, nameEn: unitNameEn(id) }))
    .sort((a, b) => a.id - b.id);

  let upazilas = agg.upazilaCount;
  if (!upazilas) {
    try {
      const u = await env.DB.prepare(`SELECT COUNT(*) AS c FROM upazila`).first<{ c: number }>();
      upazilas = u?.c ?? 0;
    } catch {
      upazilas = 0;
    }
  }

  return {
    commodities: agg.commodityCount,
    commoditiesWithData: agg.commoditiesWithData,
    districts: agg.districtCount,
    districtsWithData: agg.districtsWithData,
    upazilas,
    days: agg.days,
    rows: agg.rowCount,
    carriedPct: agg.carriedPct,
    firstDate: agg.firstDate,
    latestDate: agg.latestDate,
    units: units.map((u) => ({ id: u.id, name_bn: u.nameBn, name_en: u.nameEn })),
  };
}

function docResponse(doc: Doc, ctx: RenderContext, fmt: Format): Response {
  if (fmt === "json") return json(renderDocJson(doc, ctx), ctx);
  if (fmt === "markdown") return md(renderDocMarkdown(doc, ctx), ctx);
  return html(renderDocHtml(doc, ctx), ctx);
}

async function datasetPage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  return docResponse(datasetDoc(await datasetStats(env), ctx), ctx, fmt);
}

async function methodologyPage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  return docResponse(methodologyDoc(await datasetStats(env), ctx), ctx, fmt);
}

async function licencePage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  return docResponse(licenceDoc(ctx), ctx, fmt);
}

async function apiDocPage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  return docResponse(apiDoc(ctx), ctx, fmt);
}

async function pricingPage(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  return docResponse(pricingDoc(ctx), ctx, fmt);
}

async function verifyPage(
  env: Env,
  ctx: RenderContext,
  request: Request,
  url: URL,
  fmt: Format,
): Promise<Response> {
  const claim = url.searchParams.get("claim") ?? "";
  if (!claim) {
    if (fmt === "json") {
      return json(
        { page: "/verify", claim: null, verdict: null, hint: "Pass ?claim=… to verify a claim." },
        ctx,
      );
    }
    if (fmt === "markdown") {
      return md(`# দাবি যাচাই করুন\n\nযাচাই করতে \`?claim=\` প্যারামিটার দিন।\n`, ctx);
    }
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
    result?: {
      content?: { text?: string }[];
      structuredContent?: Record<string, unknown>;
    };
  };
  const text = payload.result?.content?.[0]?.text ?? "";
  const verdictUrl = (payload.result?.structuredContent?.url as string) ?? null;
  const verdict = text.includes("মিলেছে");

  if (fmt === "json") {
    return json(
      {
        page: "/verify",
        claim,
        verdict: text.split("\n")[1] ?? null,
        verified: verdict,
        detail: text,
        url: verdictUrl,
        source: SOURCE,
      },
      ctx,
    );
  }
  if (fmt === "markdown") {
    return md(`# যাচাই: ${claim}\n\n${text}\n`, ctx);
  }

  return html(
    renderVerifyHtml(claim, { ok: verdict, text, url: verdictUrl, actual: null }, ctx),
    ctx,
  );
}

async function notFound(env: Env, ctx: RenderContext, fmt: Format): Promise<Response> {
  if (fmt === "json") {
    return json({ error: "Not Found", hint: "see /api" }, ctx, 404);
  }
  if (fmt === "markdown") {
    return md(`# ৪০৪ — পাতা পাওয়া যায়নি\n\nহোমে ফিরুন: ${ctx.origin}/\n`, ctx, 404);
  }
  return html(renderNotFoundHtml(ctx), ctx, 404);
}
