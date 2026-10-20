/**
 * Rendering: one canonical set of facts, three representations.
 *
 *   text/html        → humans, and the surface AI crawlers read
 *   text/markdown    → agents that ask for markdown (Cloudflare "Markdown for
 *                      Agents", Vercel content negotiation)
 *   application/json → machines
 *
 * All three carry the same canonical URL and the same numbers. The point is
 * that an assistant can land on exactly one fact and quote it verbatim.
 *
 * Two things matter most for being cited, per the 2026 literature:
 *   1. the title must be the question ("আজ পেঁয়াজের দাম কত?");
 *   2. the first paragraph must be the answer, with the numbers in it.
 * Formatting tricks (FAQ blocks, schema.org as a citation tactic) measurably
 * do not help, so we do not use them.
 */

import { formatBdt, toBanglaDigits } from "./normalize";
import type { PriceRowOut } from "./db";

export interface RenderContext {
  origin: string;
  sourceName: string;
  latestDate: string | null;
  /** ISO timestamp of the render, used for the JSON-LD dateModified. */
  generatedAt: string;
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

export function layout(opts: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  ctx: RenderContext;
  jsonLd?: unknown;
  extraHead?: string;
}): string {
  const { title, description, canonical, body, ctx, jsonLd } = opts;
  const jsonLdBlock = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n` : "";
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="bn_BD">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="text/markdown" href="${esc(canonical)}.md">
<link rel="alternate" type="application/json" href="${esc(canonical)}.json">
${jsonLdBlock}${opts.extraHead ?? ""}
<style>
:root{--ink:#16210f;--muted:#5b6b52;--line:#dfe6d8;--bg:#fbfcf8;--card:#fff;--accent:#1f6f3f;--warn:#8a5a00;--warnbg:#fff8e6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Hind Siliguri","Noto Sans Bengali","SolaimanLipi",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.65}
.wrap{max-width:960px;margin:0 auto;padding:20px 18px 64px}
header.site{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:26px}
header.site .brand{font-size:1.5rem;font-weight:700;letter-spacing:-.01em}
header.site .brand a{color:var(--ink);text-decoration:none}
header.site .tag{color:var(--muted);font-size:.9rem;margin-top:2px}
nav.crumbs{font-size:.85rem;color:var(--muted);margin:0 0 14px}
nav.crumbs a{color:var(--accent)}
h1{font-size:1.75rem;line-height:1.35;margin:0 0 10px;letter-spacing:-.01em}
.answer{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:16px 18px;margin:0 0 22px}
.answer p{margin:0 0 8px}
.answer p:last-child{margin:0}
.meta{color:var(--muted);font-size:.85rem;margin-top:10px}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:0 0 22px;font-size:.95rem}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line)}
th{background:#f2f5ee;font-weight:600;font-size:.85rem;color:var(--muted);text-transform:none}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums}
a{color:var(--accent)}
.badge{display:inline-block;font-size:.72rem;padding:2px 7px;border-radius:20px;border:1px solid var(--line);color:var(--muted);background:#f6f8f3;white-space:nowrap}
.badge.warn{color:var(--warn);background:var(--warnbg);border-color:#f0dfae}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:13px 15px}
.card .n{font-weight:600;margin-bottom:3px}
.card .p{color:var(--muted);font-size:.88rem}
section h2{font-size:1.1rem;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
footer.site{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
footer.site a{color:var(--accent)}
code{background:#f2f5ee;padding:1px 5px;border-radius:4px;font-size:.88em}
pre{background:#16210f;color:#eaf2e4;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:.85rem;line-height:1.5}
pre code{background:none;color:inherit;padding:0}
</style>
</head>
<body>
<div class="wrap">
<header class="site">
  <div class="brand"><a href="/">দরদেখা</a></div>
  <div class="tag">বাংলাদেশের সরকারি কৃষি বাজারদর — প্রতিদিন, স্বাচ্ছ, যাচাইযোগ্য</div>
</header>
${body}
<footer class="site">
  <p>উৎস: ${esc(ctx.sourceName)} · সর্বশেষ তারিখ: <strong>${esc(ctx.latestDate ?? "—")}</strong> · আপডেট: ${esc(ctx.generatedAt)}</p>
  <p><a href="/dataset">ডেটাসেট</a> · <a href="/methodology">পদ্ধতি</a> · <a href="/licence">লাইসেন্স</a> · <a href="/api">API</a> · <a href="/llms.txt">llms.txt</a> · <a href="/mcp">MCP</a></p>
</footer>
</div>
</body>
</html>`;
}

/** A single price fact, ready to be rendered. */
export interface PriceFact {
  commodityBn: string;
  commodityEn: string;
  districtBn: string;
  districtEn: string;
  date: string;
  retail: { min: number | null; max: number | null; avg: number | null; unitBn: string; unitEn: string };
  wholesale: { min: number | null; max: number | null; avg: number | null; unitBn: string; unitEn: string } | null;
  url: string;
  carriedForward: boolean;
  anomaly: string | null;
}

export function priceSentence(f: PriceFact): string {
  const parts: string[] = [];
  if (f.retail.avg !== null) {
    const range =
      f.retail.min !== null && f.retail.max !== null && f.retail.max !== f.retail.min
        ? `${formatBdt(f.retail.min)}–${formatBdt(f.retail.max)} টাকা`
        : `${formatBdt(f.retail.avg)} টাকা`;
    parts.push(`খুচরা ${range} প্রতি ${f.retail.unitBn}`);
  }
  if (f.wholesale?.avg !== null && f.wholesale) {
    const range =
      f.wholesale.min !== null && f.wholesale.max !== null && f.wholesale.max !== f.wholesale.min
        ? `${formatBdt(f.wholesale.min)}–${formatBdt(f.wholesale.max)} টাকা`
        : `${formatBdt(f.wholesale.avg)} টাকা`;
    parts.push(`পাইকারি ${range} প্রতি ${f.wholesale.unitBn}`);
  }
  return parts.join(", ");
}

/** Canonical per-fact URL. */
export function factUrl(origin: string, commoditySlug: string, districtSlug: string, date: string): string {
  return `${origin.replace(/\/$/, "")}/price/${commoditySlug}/${districtSlug}/${date}`;
}

export function renderPriceFactHtml(f: PriceFact, ctx: RenderContext): string {
  const title = `${f.commodityBn} এর দর ${f.districtBn} — ${f.date}`;
  const sentence = priceSentence(f);
  const canonical = f.url;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${f.commodityBn} — বাজারদর, ${f.districtBn}`,
    description: `${f.commodityBn} এর ${f.date} তারিখের খুচরা ও পাইকারি দর: ${sentence}`,
    url: canonical,
    dateModified: f.date,
    creator: { "@type": "Organization", name: "দরদেখা" },
    isBasedOn: ctx.sourceName,
    license: "https://dordekha.pages.dev/licence",
    variableMeasured: ["retail price", "wholesale price"],
    measurementTechnique: "কৃষি মন্ত্রণালয় / DAM অনলাইন বাজারদর প্রতিদিনের রিপোর্ট",
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: `${canonical}.json`,
    },
  };

  const body = `<nav class="crumbs"><a href="/">হোম</a> › <a href="/price">পণ্য</a> › ${esc(f.districtBn)} › ${esc(f.date)}</nav>
<h1>${esc(f.commodityBn)} এর দর ${esc(f.districtBn)} — ${esc(f.date)}</h1>
<div class="answer">
  <p><strong>${esc(f.commodityBn)}</strong> এর ${esc(f.date)} তারিখে ${esc(f.districtBn)} জেলায় ${esc(sentence)}।</p>
  <p class="meta">উৎস: ${esc(ctx.sourceName)} · তারিখ: ${esc(f.date)}</p>
  ${f.carriedForward ? `<p><span class="badge warn">আগের দিনের মান পুনরায় ব্যবহার করা হয়েছে</span></p>` : ""}
  ${f.anomaly ? `<p><span class="badge warn">তথ্য-সতর্কতা: ${esc(f.anomaly)}</span></p>` : ""}
</div>
<p><a href="${esc(canonical)}.md">Markdown</a> · <a href="${esc(canonical)}.json">JSON</a> · <a href="/price/${esc(f.commodityEn ? "" : "")}">সব পণ্য</a></p>`;

  return layout({ title, description: `${f.commodityBn} ${f.districtBn} ${f.date}: ${sentence}`, canonical, body, ctx, jsonLd });
}

export function renderPriceFactMarkdown(f: PriceFact, ctx: RenderContext): string {
  const sentence = priceSentence(f);
  const lines = [
    `# ${f.commodityBn} — বাজারদর, ${f.districtBn} (${f.date})`,
    "",
    `**${f.commodityBn}** এর ${f.date} তারিখে ${f.districtBn} জেলায় ${sentence}।`,
    "",
  ];
  if (f.carriedForward) lines.push("> ⚠️ এই মানটি আগের প্রতিবেদন থেকে পুনরায় ব্যবহার করা হয়েছে।", "");
  if (f.anomaly) lines.push(`> ⚠️ তথ্য-সতর্কতা: ${f.anomaly}`, "");
  lines.push(
    `- **উৎস:** ${ctx.sourceName}`,
    `- **তারিখ:** ${f.date}`,
    `- **স্থায়ী লিংক:** ${f.url}`,
    `- **JSON:** ${f.url}.json`,
    "",
  );
  return lines.join("\n");
}

export function renderPriceFactJson(f: PriceFact, ctx: RenderContext): unknown {
  return {
    commodity: { name_bn: f.commodityBn, name_en: f.commodityEn },
    district: { name_bn: f.districtBn, name_en: f.districtEn },
    price_date: f.date,
    prices: {
      retail: {
        min: f.retail.min,
        max: f.retail.max,
        avg: f.retail.avg,
        unit_bn: f.retail.unitBn,
        unit_en: f.retail.unitEn,
      },
      wholesale: f.wholesale
        ? {
            min: f.wholesale.min,
            max: f.wholesale.max,
            avg: f.wholesale.avg,
            unit_bn: f.wholesale.unitBn,
            unit_en: f.wholesale.unitEn,
          }
        : null,
    },
    carried_forward: f.carriedForward,
    anomaly: f.anomaly,
    source: { name: ctx.sourceName, url: "https://moa-services.com/agri-service" },
    canonical_url: f.url,
    retrieved_at: ctx.generatedAt,
    licence: "https://dordekha.pages.dev/licence",
  };
}

/** Commodity page: latest snapshot across districts + 30-day trend. */
export interface CommodityPageData {
  commodity: { id: number; bn: string; en: string; slug: string; groupBn: string };
  date: string | null;
  districtRows: (PriceRowOut & { districtNameBn: string; districtNameEn: string; districtSlug: string })[];
  history: { date: string; retailAvg: number | null; wholesaleAvg: number | null }[];
  national: { date: string; retailAvg: number | null; wholesaleAvg: number | null }[];
}

export function renderCommodityHtml(d: CommodityPageData, ctx: RenderContext): string {
  const title = `আজ ${d.commodity.bn} এর বাজারদর — সব জেলা`;
  const canonical = `${ctx.origin.replace(/\/$/, "")}/price/${d.commodity.slug}`;

  const withData = d.districtRows.filter((r) => r.retail?.avg != null);
  const avgRetail = withData.length
    ? withData.reduce((s, r) => s + (r.retail?.avg ?? 0), 0) / withData.length
    : null;

  const summary = withData.length
    ? `আজ (${d.date ?? "—"}) ${d.commodity.bn} এর জেলা-ভিত্তিক খুচরা দর জাতীয় গড় ${formatBdt(avgRetail)} টাকা; ${withData.length}টি জেলা থেকে তথ্য এসেছে।`
    : `এখনো ${d.commodity.bn} এর জেলা-ভিত্তিক দর প্রকাশ করা হয়নি।`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${d.commodity.bn} — বাংলাদেশের দৈনিক বাজারদর`,
    description: summary,
    url: canonical,
    creator: { "@type": "Organization", name: "দরদেখা" },
    isBasedOn: ctx.sourceName,
    license: "https://dordekha.pages.dev/licence",
    variableMeasured: ["retail price", "wholesale price", "district"],
    dateModified: d.date ?? undefined,
  };

  const rows = d.districtRows
    .map(
      (r) => `<tr>
      <td><a href="/price/${esc(d.commodity.slug)}/${esc(r.districtSlug)}">${esc(r.districtNameBn)}</a></td>
      <td class="num">${esc(formatBdt(r.retail?.min))}–${esc(formatBdt(r.retail?.max))}</td>
      <td class="num">${esc(formatBdt(r.retail?.avg))}</td>
      <td class="num">${esc(formatBdt(r.wholesale?.avg))}</td>
      <td>${r.carriedForward ? '<span class="badge warn">পূর্বের মান</span>' : ""}${r.anomaly ? ' <span class="badge warn">সতর্কতা</span>' : ""}</td>
    </tr>`,
    )
    .join("\n");

  const body = `<nav class="crumbs"><a href="/">হোম</a> › <a href="/price">পণ্য</a> › ${esc(d.commodity.bn)}</nav>
<h1>${esc(d.commodity.bn)} এর বাজারদর — ${esc(d.date ?? "—")}</h1>
<div class="answer">
  <p>${esc(summary)}</p>
  <p class="meta">গ্রুপ: ${esc(d.commodity.groupBn)} · উৎস: ${esc(ctx.sourceName)}</p>
</div>
<section>
<h2>জেলা অনুযায়ী দর</h2>
<table>
<thead><tr><th>জেলা</th><th>খুচরা (ন্যূনতম–সর্বোচ্চ)</th><th>খুচরা গড়</th><th>পাইকারি গড়</th><th>নোট</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">কোনো তথ্য নেই</td></tr>'}</tbody>
</table>
</section>
${renderTrendBlock(d)}
<p><a href="${esc(canonical)}.md">Markdown</a> · <a href="${esc(canonical)}.json">JSON</a></p>`;

  return layout({ title, description: summary, canonical, body, ctx, jsonLd });
}

function renderTrendBlock(d: CommodityPageData): string {
  const pts = d.history.filter((h) => h.retailAvg !== null);
  if (pts.length < 2) return "";
  const first = pts[0]?.retailAvg ?? 0;
  const last = pts[pts.length - 1]?.retailAvg ?? 0;
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const dir = change > 0 ? "বেড়েছে" : change < 0 ? "কমেছে" : "পরিবর্তন হয়নি";
  return `<section>
<h2>শেষ ${pts.length} দিনের ধারা</h2>
<div class="answer">
  <p>গত ${pts.length} প্রতিবেদনে ${esc(d.commodity.bn)} এর জেলা-গড় খুচরা দর ${formatBdt(first)} টাকা থেকে ${formatBdt(last)} টাকা হয়েছে — ${esc(dir)} ${Math.abs(change).toFixed(1)}%।</p>
</div>
<table>
<thead><tr><th>তারিখ</th><th>খুচরা গড়</th><th>পাইকারি গড়</th></tr></thead>
<tbody>${pts
  .slice()
  .reverse()
  .map(
    (p) =>
      `<tr><td>${esc(p.date)}</td><td class="num">${esc(formatBdt(p.retailAvg))}</td><td class="num">${esc(formatBdt(p.wholesaleAvg))}</td></tr>`,
  )
  .join("\n")}</tbody>
</table>
</section>`;
}

export function renderCommodityMarkdown(d: CommodityPageData, ctx: RenderContext): string {
  const lines = [
    `# ${d.commodity.bn} — বাংলাদেশের দৈনিক বাজারদর`,
    "",
    `তারিখ: ${d.date ?? "—"} · উৎস: ${ctx.sourceName}`,
    "",
    "## জেলা অনুযায়ী দর",
    "",
    "| জেলা | খুচরা ন্যূনতম | খুচরা সর্বোচ্চ | খুচরা গড় | পাইকারি গড় |",
    "|---|---|---|---|---|",
  ];
  for (const r of d.districtRows) {
    lines.push(
      `| ${r.districtNameBn} | ${formatBdt(r.retail?.min)} | ${formatBdt(r.retail?.max)} | ${formatBdt(r.retail?.avg)} | ${formatBdt(r.wholesale?.avg)} |`,
    );
  }
  lines.push("", `স্থায়ী লিংক: ${ctx.origin.replace(/\/$/, "")}/price/${d.commodity.slug}`, "");
  return lines.join("\n");
}

/** Home page. */
export function renderHomeHtml(
  data: {
    latestDate: string | null;
    headline: { bn: string; value: string; unit: string }[];
    groups: { id: number; bn: string; count: number }[];
    commodityCount: number;
    districtCount: number;
    daysCovered: number;
  },
  ctx: RenderContext,
): string {
  const title = "আজকের বাজারদর — বাংলাদেশ, প্রতিদিন, সরকারি তথ্য";
  const description = `বাংলাদেশের ${data.districtCount}টি জেলা ও ${data.commodityCount}টি পণ্যের সরকারি দৈনিক বাজারদর, ইউনিট-সংশোধিত ও ধাপে ধাপে যাচাই করা। সর্বশেষ তারিখ: ${data.latestDate ?? "—"}.`;
  const canonical = `${ctx.origin.replace(/\/$/, "")}/`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "দরদেখা — বাংলাদেশের দৈনিক বাজারদর",
    description,
    url: canonical,
    creator: { "@type": "Organization", name: "দরদেখা" },
    isBasedOn: ctx.sourceName,
    license: "https://dordekha.pages.dev/licence",
    dateModified: data.latestDate ?? undefined,
    variableMeasured: ["retail price", "wholesale price"],
  };

  const cards = data.headline
    .map(
      (h) =>
        `<div class="card"><div class="n">${esc(h.bn)}</div><div class="p">${esc(h.value)} টাকা / ${esc(h.unit)}</div></div>`,
    )
    .join("\n");

  const groupLinks = data.groups
    .map((g) => `<div class="card"><div class="n">${esc(g.bn)}</div><div class="p">${g.count}টি পণ্য</div></div>`)
    .join("\n");

  const body = `<h1>আজকের বাজারদর — বাংলাদেশ</h1>
<div class="answer">
  <p>এই সাইটে প্রতিদিন কৃষি মন্ত্রণালয়ের (কৃষি বিপণন অধিদপ্তর) অনলাইন বাজারদর রিপোর্ট থেকে ${data.districtCount}টি জেলার খুচরা ও পাইকারি দর দেখানো হয়, ইউনিট সংশোধন করে এবং প্রতিটি তথ্যের উৎস ও তারিখ উল্লেখ করে। সর্বশেষ প্রতিবেদন: <strong>${esc(data.latestDate ?? "—")}</strong>।</p>
  <p class="meta">পরিসংখ্যান: ${data.commodityCount}টি পণ্য · ${data.districtCount}টি জেলা · ${data.daysCovered} দিনের ইতিহাস</p>
</div>
<section><h2>আজকের কয়েকটি দর</h2><div class="grid">${cards}</div></section>
<section><h2>পণ্যের ধরন</h2><div class="grid">${groupLinks}</div></section>
<section>
<h2>যেভাবে ব্যবহার করবেন</h2>
<p>এই তথ্য যেকোনো AI সহকারী (ChatGPT, Claude, Perplexity) নিজে টেনে নিতে পারে — <a href="/mcp">MCP server</a> দেখুন। মানব-পাঠযোগ্য URL-এর পাশাপাশি <code>text/markdown</code> ও <code>application/json</code> সংস্করণও পাওয়া যায়।</p>
<p>প্রতিটি পৃষ্ঠার URL-এর শেষে <code>.md</code> বা <code>.json</code> যোগ করে সেই একই তথ্য পড়তে বা পার্স করতে পারবেন।</p>
</section>`;

  return layout({ title, description, canonical, body, ctx, jsonLd });
}

export function renderHomeMarkdown(data: { latestDate: string | null; headline: { bn: string; value: string; unit: string }[] }, ctx: RenderContext): string {
  const lines = [
    "# দরদেখা — বাংলাদেশের দৈনিক বাজারদর",
    "",
    `সর্বশেষ প্রতিবেদন: ${data.latestDate ?? "—"}`,
    `উৎস: ${ctx.sourceName}`,
    "",
    "## আজকের কয়েকটি দর",
    "",
  ];
  for (const h of data.headline) lines.push(`- **${h.bn}**: ${h.value} টাকা / ${h.unit}`);
  lines.push("", "স্থায়ী লিংক: " + ctx.origin, "");
  return lines.join("\n");
}

export { toBanglaDigits };
