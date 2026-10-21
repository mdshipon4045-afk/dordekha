/**
 * The secondary pages, in the same "খাতা" design language as the home page.
 *
 * Each of these is also a place an AI assistant might land or cite, so the
 * first line of each page states what the page is and what it contains,
 * in the same shape as the per-fact pages.
 */

import { esc, formatBdt } from "./render";
import type { RenderContext } from "./render";

function band(opts: { kicker: string; title: string; lead: string; inner: string; style?: string }): string {
  return `<section class="band"${opts.style ? ` style="${opts.style}"` : ""}>
  <div class="shell">
    <div class="eyebrow"><span class="dot"></span> ${esc(opts.kicker)}</div>
    <h1 style="font-size:clamp(30px,4.8vw,46px)">${opts.title}</h1>
    <p class="lead">${esc(opts.lead)}</p>
    ${opts.inner}
  </div>
</section>`;
}

/* ── পণ্যতালিকা ─────────────────────────────────────────────────────────── */

export interface PriceIndexItem {
  bn: string;
  en: string;
  group: string;
  slug: string;
  retailAvg: number | null;
  unitBn: string;
}

export function renderPriceIndexHtml(items: PriceIndexItem[], ctx: RenderContext): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}/price`;
  const groups = new Map<string, PriceIndexItem[]>();
  for (const i of items) {
    const list = groups.get(i.group) ?? [];
    list.push(i);
    groups.set(i.group, list);
  }

  const sections = [...groups.entries()]
    .map(
      ([group, list]) => `<div style="margin-top:30px">
      <div class="sec-head"><span class="sec-kicker">${esc(group)}</span><h2 style="font-size:22px">${list.length}টি পণ্য</h2></div>
      <div class="sheet">
        <table class="ledger">
          <thead><tr><th>পণ্য</th><th>নাম (ইংরেজি)</th><th class="n">গড় খুচরা দর</th><th>একক</th></tr></thead>
          <tbody>${list
            .map(
              (i) => `<tr>
              <td class="c-item"><a href="/price/${esc(i.slug)}">${esc(i.bn)}</a></td>
              <td class="n" style="text-align:left;color:var(--faint);font-family:var(--font-mono);font-size:12.5px">${esc(i.en)}</td>
              <td class="n">${esc(formatBdt(i.retailAvg))}</td>
              <td class="c-prov">${esc(i.unitBn)}</td>
            </tr>`,
            )
            .join("\n")}</tbody>
        </table>
      </div>
    </div>`,
    )
    .join("\n");

  const body = band({
    kicker: "সব পণ্য",
    title: "পণ্যতালিকা",
    lead: `দরদেখায় মোট ${items.length}টি পণ্যের দর প্রকাশ করা হয়। প্রতিটি পণ্যের পাতায় জেলা অনুযায়ী খুচরা ও পাইকারি দর, সাম্প্রতিক ধারা এবং উৎস রয়েছে।`,
    inner: sections,
  });

  return layoutPage({
    title: "পণ্যতালিকা — বাংলাদেশের দৈনিক বাজারদর",
    description: `${items.length}টি পণ্যের জেলা-ভিত্তিক দৈনিক বাজারদর, উৎস ও তারিখসহ।`,
    canonical,
    body,
    ctx,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "পণ্যতালিকা — দরদেখা",
      url: canonical,
      creator: { "@type": "Organization", name: "দরদেখা" },
      isBasedOn: ctx.sourceName,
    },
  });
}

/* ── ডেটাসেট ───────────────────────────────────────────────────────────── */

export function renderDatasetHtml(
  stats: { commodities: number; districts: number; upazilas: number; days: number; rows: number },
  ctx: RenderContext,
): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}/dataset`;
  const body = band({
    kicker: "ডেটাসেট",
    title: "ডেটাসেট",
    lead: "বাংলাদেশের কৃষি মন্ত্রণালয়ের (কৃষি বিপণন অধিদপ্তর) প্রতিদিনের অনলাইন বাজারদর রিপোর্ট থেকে তৈরি একটি মেশিন-পড়যোগ্য ডেটাসেট। প্রতিটি সংখ্যা উৎস-তারিখসহ রক্ষিত, ইউনিট সংশোধিত এবং যাঁরা জমা দেননি তাদের জন্য স্পষ্ট চিহ্নিত।",
    inner: `<div class="sheet" style="margin-top:26px">
      <div class="sheet-bar"><span>পরিসংখ্যান</span><span>আপডেট ${esc(ctx.generatedAt.slice(0, 10))}</span></div>
      <table class="ledger">
        <thead><tr><th>বিষয়</th><th class="n">মান</th><th>বিবরণ</th></tr></thead>
        <tbody>
          <tr><td class="c-item">পণ্য</td><td class="n">${stats.commodities}</td><td class="c-prov">২২টি পণ্য-গ্রুপে</td></tr>
          <tr><td class="c-item">জেলা</td><td class="n">${stats.districts}</td><td class="c-prov">৬৪টি জেলা</td></tr>
          <tr><td class="c-item">উপজেলা</td><td class="n">${stats.upazilas}</td><td class="c-prov">ক্রমানুসারে যুক্ত হচ্ছে</td></tr>
          <tr><td class="c-item">প্রতিবেদনের দিন</td><td class="n">${stats.days}</td><td class="c-prov">আর্কাইভ</td></tr>
          <tr><td class="c-item">মোট সারি</td><td class="n">${stats.rows.toLocaleString("en-US")}</td><td class="c-prov">খুচরা ও পাইকারি</td></tr>
        </tbody>
      </table>
    </div>

    <div class="pillars" style="margin-top:22px">
      <div class="pillar">
        <div class="num">আছে</div>
        <h3>যা পাবেন</h3>
        <p>প্রতিটি পণ্যের খুচরা ও পাইকারি — ন্যূনতম, সর্বোচ্চ ও গড়। জেলা ভিত্তিক তথ্য, উপজেলা ভিত্তিক তথ্য (ক্রমানুসারে যুক্ত হচ্ছে), ইতিহাস, একক করা ইউনিট, এবং প্রতিটি সারিতে তথ্যের তারিখ ও সতর্কতা-চিহ্ন।</p>
      </div>
      <div class="pillar">
        <div class="num">নেই</div>
        <h3>যা নেই</h3>
        <p>সরকারি রিপোর্টে যেসব জেলা বা উপজেলা জমা দেয়নি, সেখানে কোনো মান তৈরি করা হয় না। বাজারের প্রকৃত লেনদেনের দর — এটি সরকারি নজরদারির দর, চুক্তির দর নয়। কোনো অনুমান বা ইন্টারপোলেশন করা হয় না।</p>
      </div>
      <div class="pillar">
        <div class="num">ব্যবহার</div>
        <h3>যেভাবে নেবেন</h3>
        <p>REST API, CSV এক্সপোর্ট, MCP server, বা পাতার <code>.md</code> ও <code>.json</code> সংস্করণ। প্রতিটি উত্তরে উৎস, তারিখ ও একটি উদ্ধৃতিযোগ্য URL থাকে।</p>
      </div>
    </div>

    <div class="callout" style="margin-top:22px">
      <b>উদ্ধৃতির নিয়ম:</b> উৎস (কৃষি মন্ত্রণালয় / DAM) উল্লেখ করা বাধ্যতামূলক। একটি নির্দিষ্ট তথ্য উদ্ধৃত করতে সেই পাতার canonical URL ব্যবহার করুন — যেমন <code>/price/পণ্য/জেলা/তারিখ</code>। বিস্তারিত: <a href="/licence">লাইসেন্স</a>।
    </div>`,
  });

  return layoutPage({
    title: "ডেটাসেট — দরদেখা",
    description:
      "বাংলাদেশের সরকারি দৈনিক কৃষি বাজারদর ডেটাসেট: ৬৪ জেলা, ৫০৫ উপজেলা, ৪৪৭ পণ্য, খুচরা ও পাইকারি।",
    canonical,
    body,
    ctx,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "দরদেখা — বাংলাদেশের দৈনিক কৃষি বাজারদর",
      description:
        "Ministry of Agriculture daily market price reports, unit-normalised and machine-readable.",
      url: canonical,
      creator: { "@type": "Organization", name: "দরদেখা" },
      isBasedOn: ctx.sourceName,
      license: `${ctx.origin.replace(/\/$/, "")}/licence`,
      temporalCoverage: "2025-06/ongoing",
      spatialCoverage: "Bangladesh",
      variableMeasured: ["retail price", "wholesale price", "district", "upazila", "commodity"],
    },
  });
}

/* ── পদ্ধতি ────────────────────────────────────────────────────────────── */

export function renderMethodologyHtml(ctx: RenderContext): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}/methodology`;
  const body = band({
    kicker: "পদ্ধতি",
    title: "কীভাবে সংখ্যা তৈরি হয়",
    lead: "প্রতিটি সংখ্যা কৃষি মন্ত্রণালয়ের অনলাইন বাজারদর রিপোর্ট থেকে সরাসরি নেওয়া। পার্থক্য শুধু তিনটি জায়গায়: ইউনিট ঠিক করা, ফাঁকা (গ্যাপ) স্পষ্ট করা, এবং পুরোনো মান পুনরায় ব্যবহারের ক্ষেত্রে চিহ্নিত করা।",
    inner: `<div class="pillars" style="margin-top:26px">
      <div class="pillar">
        <div class="num">০১</div>
        <h3>ইউনিট সংশোধন</h3>
        <p>উৎস ডেটায় পাইকারি মানটি প্রকৃত অনুপাতে লেখা নেই। গম ও শস্যে খুচরা মান প্রতি কেজি, আর পাইকারি মান প্রতি ১০০ কেজির জন্য — অথচ সেটিকে "কুইন্টাল" বলা হয়েছে (প্রমাণিত কুইন্টাল ৩৭.৩২ কেজি)।</p>
        <p style="margin-top:10px">ফলে চাল-আমন-সরু, ঢাকা: খুচরা ৮০ টাকা/কেজি, পাইকারি raw ৭২৫০। ৩৭.৩২ দিয়ে ভাগ করলে ১৯৪ টাকা/কেজি — খুচরার <b>উপরে</b>, অসম্ভব। সঠিক স্কেল ১০০ দিয়ে ভাগ করলে ৭২.৫ টাকা/কেজি — খুচরার <b>নিচে</b>, বাস্তবসম্মত।</p>
      </div>
      <div class="pillar">
        <div class="num">০২</div>
        <h3>ফাঁকা (গ্যাপ) সৎভাব</h3>
        <p>উৎসে কোনো তারিখে কোনো জেলা জমা দেয়নি, সেখানে কোনো সংখ্যা তৈরি করা হয় না। পরের তারিখের প্রতিবেদন দেখিয়ে চলে যায় না — বরং "এই তারিখে তথ্য নেই" বলা হয়।</p>
        <p style="margin-top:10px">প্রায় ৫৪% সারি আগের দিনের মান পুনরায় ব্যবহার করা — তাই দাম বদলেছে বলা যায় কেবল নতুন জমা দেওয়া সারি থেকে, এবং পুরোনো মান চিহ্নিত থাকে।</p>
      </div>
      <div class="pillar">
        <div class="num">০৩</div>
        <h3>যাচাই ও সংশোধন</h3>
        <p>প্রতিটি সারিতে উৎস-তারিখ, ইউনিট-গুণক এবং সংশোধনের কারণ সংরক্ষিত থাকে। পাইকারি গড় খুচরা গড়ের উপরে হলে সারিটি সতর্কতা-চিহ্নিত হয় এবং নীরবে ছাড়া হয় না।</p>
        <p style="margin-top:10px">ফ্যাক্ট পেজে প্রতিটি দাবির সাথে URL ও JSON রূপ আছে, যা AI সহকারী নিজে টেনে নিতে পারে।</p>
      </div>
    </div>

    <div class="callout" style="margin-top:22px">
      <b>যা আমরা করি না:</b> কোনো মান অনুমান করি না, কোনো তারিখের তথ্য পরের দিনে সরাই না, আর কোনো সংখ্যাকে উৎসের চেয়ে বেশি নিখুঁত করি না।
    </div>`,
  });

  return layoutPage({
    title: "পদ্ধতি — দরদেখা",
    description:
      "দরদেখা কীভাবে সরকারি বাজারদরের সংখ্যা সংশোধন ও যাচাই করে: ইউনিট সংশোধন, গ্যাপ-সততা, পুরোনো মান চিহ্নিতকরণ।",
    canonical,
    body,
    ctx,
  });
}

/* ── লাইসেন্স ──────────────────────────────────────────────────────────── */

export function renderLicenceHtml(ctx: RenderContext): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}/licence`;
  const body = band({
    kicker: "লাইসেন্স",
    title: "লাইসেন্স ও ব্যবহারের শর্ত",
    lead: "দরদেখা ডেটা মূলত সরকারি উৎস থেকে নেওয়া। উপরের লাইসেন্সটি আমাদের নিজস্ব প্রক্রিয়াগত অবস্থান — বাণিজ্যিক ব্যবহারের আগে কৃষি বিপণন অধিদপ্তরের সঙ্গে লাইসেন্স/সমচ্ছেদ বিষয়ে যোগাযোগ করা হয়।",
    inner: `<div class="pillars" style="margin-top:26px">
      <div class="pillar">
        <div class="num">০১</div>
        <h3>ব্যক্তিগল ও গবেষণা</h3>
        <p>ব্যক্তিগত পরিচয়, গবেষণা, শিক্ষা ও সংবাদ-পত্রের ব্যবহারের জন্য তথ্য নেওয়া ও প্রকাশ করা যায়। উৎস (কৃষি মন্ত্রণালয় / DAM) উল্লেখ করা বাধ্যতামূলক।</p>
      </div>
      <div class="pillar">
        <div class="num">০২</div>
        <h3>বাণিজ্যিক ব্যবহার</h3>
        <p>বাণিজ্যিক ব্যবহার (অ্যাপ, এন্টারপ্রাইজ ইন্টিগ্রেশন, পুনঃবিতরণ) একটি লাইসেন্সের অধীনে। ধরন: বাণিজ্যিক ব্যবহারের অনুমতি, API, অ্যালার্ট ও বাল্ক ডেটা এক্সপোর্ট।</p>
      </div>
      <div class="pillar">
        <div class="num">০৩</div>
        <h3>দায়বশীমতা</h3>
        <p>তথ্য সরকারি রিপোর্টের নিবন্ধনের উপর ভিত্তি করে দেওয়া হয়েছে। ভুল ব্যাখ্যা, অসম্পূর্ণ উপস্থাপন, অথবা মূল উৎসের পরিবর্তন ছাড়া ব্যবহার নিষিদ্ধ।</p>
      </div>
    </div>

    <div class="sheet" style="margin-top:22px">
      <div class="sheet-bar"><span>REST API</span><span>টাকা প্রতি মাস</span></div>
      <pre><code>GET /api/v1/latest?district=47
GET /api/v1/price?commodity=পেঁয়াজ&amp;district=পাবনা
GET /api/v1/series.csv?commodity=602&amp;district=47
GET /api/v1/search?q=পেঁয়াজ ঢাকা</code></pre>
    </div>
    <p style="margin-top:16px;font-size:15px">মূল্য ও যোগাযোগের বিবরণ: <a href="/api">API</a> পাতা।</p>`,
  });

  return layoutPage({
    title: "লাইসেন্স — দরদেখা",
    description: "দরদেখা ডেটার ব্যবহারের শর্ত: ব্যক্তিগল ও গবেষণার ব্যবহার, এবং বাণিজ্যিক ব্যবহারের লাইসেন্স।",
    canonical,
    body,
    ctx,
  });
}

/* ── API ────────────────────────────────────────────────────────────────── */

export function renderApiHtml(ctx: RenderContext): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}/api`;
  const body = band({
    kicker: "ডেভেলপার",
    title: "API ও MCP",
    lead: "দরদেখার তথ্য REST API, CSV এক্সপোর্ট ও MCP server — তিনভাবে পাওয়া যায়। প্রতিটি উত্তরে উৎস, তারিখ ও একটি উদ্ধৃতিযোগ্য URL থাকে।",
    inner: `<div class="sheet" style="margin-top:26px">
      <div class="sheet-bar"><span>REST</span><span>application/json</span></div>
      <pre><code>GET /api/v1/latest?district=47
GET /api/v1/price?commodity=পেঁয়াজ&amp;district=পাবনা
GET /api/v1/search?q=পেঁয়াজ ঢাকা
GET /api/v1/series.csv?commodity=602&amp;district=47
GET /api/v1/districts
GET /api/v1/commodities</code></pre>
    </div>
    <p style="margin-top:14px;font-size:15px">দ্রুত পরীক্ষা: <a href="/api/v1/latest?district=47">/api/v1/latest?district=47</a></p>

    <div class="sheet" style="margin-top:22px">
      <div class="sheet-bar"><span>MCP server</span><span>stateless · 2026-07-28</span></div>
      <pre><code>POST /mcp
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28

{"jsonrpc":"2.0","id":1,"method":"tools/list"}</code></pre>
    </div>
    <p style="margin-top:14px;font-size:15px">টুল: <code>get_market_price</code> · <code>compare_districts</code> · <code>get_price_trend</code> · <code>verify_claim</code>। প্রতিটি ফলাফলে <code>url</code> থাকে, যা অ্যাসিস্ট্যান্টের উত্তরে ক্লিকযোগ্য উৎস হিসেবে দেখায়।</p>
    <pre style="margin-top:14px"><code>opencode mcp add dordekha --url ${esc(ctx.origin.replace(/\/$/, ""))}/mcp</code></pre>

    <div class="sheet" style="margin-top:22px">
      <div class="sheet-bar"><span>বিকল্প ফরম্যাট</span><span>text/markdown · application/json</span></div>
      <pre><code>GET /price/পণ্য/জেলা/তারিখ.md
GET /price/পণ্য/জেলা/তারিখ.json

<span class="c"># অথবা Accept হেডারে</span>
curl -H "Accept: text/markdown"  /price/পণ্য/জেলা/তারিখ
curl -H "Accept: application/json" /price/পণ্য/জেলা/তারিখ</code></pre>
    </div>`,
  });

  return layoutPage({
    title: "API ও MCP — দরদেখা",
    description: "দরদেখার REST API, CSV এক্সপোর্ট ও MCP server — AI সহকারীর জন্য মেশিন-পড়যোগ্য বাজারদর।",
    canonical,
    body,
    ctx,
  });
}

/* ── যাচাই ─────────────────────────────────────────────────────────────── */

export function renderVerifyHtml(
  claim: string,
  verdict: { ok: boolean; text: string; url: string | null; actual: string | null },
  ctx: RenderContext,
): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}/verify`;
  const answer = verdict.text
    ? `<div class="sheet" style="margin-top:22px">
        <div class="sheet-bar"><span>যাচাই</span><span>${esc(verdict.ok ? "মিলেছে" : "মিলেনি")}</span></div>
        <div style="padding:20px 18px">
          <p style="margin:0 0 12px"><strong>দাবি:</strong> ${esc(claim)}</p>
          <pre><code>${esc(verdict.text)}</code></pre>
          ${verdict.url ? `<p style="margin:14px 0 0"><a href="${esc(verdict.url)}">উৎস পাতা দেখুন →</a></p>` : ""}
        </div>
      </div>`
    : "";

  const body = band({
    kicker: "যাচাই",
    title: "দাবি যাচাই করুন",
    lead: "কোনো দাবি লিখুন — যেমন “পেঁয়াজ ৬০ টাকা ঢাকায়” — আমরা সরকারি রেকর্ডের সাথে মিলিয়ে দেখাই, আর উদ্ধৃতিযোগ্য লিংক দিই।",
    inner: `<form class="lookup" method="get" action="/verify" style="margin-top:26px">
      <div class="lookup-label">আপনার দাবি</div>
      <div class="lookup-form">
        <input name="claim" type="search" value="${esc(claim)}" placeholder="যেমন: পেঁয়াজ ৬০ টাকা ঢাকায়" aria-label="যাচাই করার জন্য দাবি">
        <button type="submit">যাচাই করুন</button>
      </div>
    </form>
    ${answer}`,
  });

  return layoutPage({
    title: claim ? `যাচাই: ${claim} — দরদেখা` : "দাবি যাচাই — দরদেখা",
    description: claim
      ? `দাবি "${claim}" সরকারি বাজারদর রেকর্ডের সাথে মিলিয়ে দেখা হয়েছে।`
      : "বাংলাদেশের সরকারি বাজারদর রেকর্ডের সাথে আপনার দাবি মিলিয়ে দেখুন।",
    canonical,
    body,
    ctx,
  });
}

/* ── "এই তারিখে তথ্য নেই" ───────────────────────────────────────────── */

/**
 * The page shown when a specific date was asked for and the source has
 * nothing for it.
 *
 * This is the honest answer, and it is the whole point: the service does
 * not fill the gap with a different day's figures. The dates that *are*
 * available are listed, so a reader (or an assistant) can find the right
 * one instead of guessing.
 */
export function renderNoDataHtml(
  opts: {
    commodity: string;
    district: string;
    date: string;
    available: { date: string; url: string }[];
    latest: string | null;
  },
  ctx: RenderContext,
): string {
  const body = band({
    kicker: "তথ্য নেই",
    title: `${opts.date} তারিখে কোনো তথ্য নেই`,
    lead: `${opts.commodity} এর ${opts.district} জেলার ${opts.date} তারিখের প্রতিবেদন উৎসে নেই। কোনো অন্য তারিখের সংখ্যা এখানে বসানো হয়নি — ভুল তারিখে ভুল দাম দেওয়ার চেয়ে ফাঁকা থাকা ভালো।`,
    inner: `${
      opts.available.length
        ? `<div class="sheet" style="margin-top:24px">
        <div class="sheet-bar"><span>যেসব তারিখে তথ্য আছে</span><span>${opts.available.length}টি</span></div>
        <table class="ledger">
          <thead><tr><th>তারিখ</th><th>উদ্ধৃতি</th></tr></thead>
          <tbody>${opts.available
            .map(
              (a) =>
                `<tr><td class="c-item">${esc(a.date)}</td><td class="c-prov"><a href="${esc(a.url)}">পাতা দেখুন →</a></td></tr>`,
            )
            .join("\n")}</tbody>
        </table>
      </div>`
        : `<div class="callout" style="margin-top:24px">এই পণ্য ও জেলার জন্য কোনো তারিখে তথ্য পাওয়া যায়নি।</div>`
    }
    <p style="margin-top:18px"><a class="btn" href="/price">সব পণ্য</a> <a class="btn" style="background:transparent;color:var(--ink);border-color:var(--rule)" href="/">হোমে ফিরুন</a></p>`,
  });

  return layoutPage({
    title: `${opts.date} তারিখে তথ্য নেই — ${opts.commodity}, ${opts.district} — দরদেখা`,
    description: `${opts.commodity} ${opts.district} ${opts.date} তারিখে সরকারি প্রতিবেদনে তথ্য নেই।`,
    canonical: `${ctx.origin.replace(/\/$/, "")}/price`,
    body,
    ctx,
  });
}

/* ── 404 ────────────────────────────────────────────────────────────────── */

export function renderNotFoundHtml(ctx: RenderContext): string {
  const body = band({
    kicker: "৪০৪",
    title: "পাতা পাওয়া যায়নি",
    lead: "এই পাতাটি নেই। হোমে ফিরে যান, পণ্যের তালিকা দেখুন, অথবা যেকোনো দাবি সরাসরি যাচাই করুন।",
    inner: `<p style="margin-top:20px"><a class="btn" href="/">হোমে ফিরুন</a> <a class="btn" style="background:transparent;color:var(--ink);border-color:var(--rule)" href="/price">পণ্যতালিকা</a> <a class="btn" style="background:transparent;color:var(--ink);border-color:var(--rule)" href="/verify">যাচাই করুন</a></p>`,
  });
  return layoutPage({
    title: "৪০৪ — দরদেখা",
    description: "পাতা পাওয়া যায়নি।",
    canonical: `${ctx.origin.replace(/\/$/, "")}/404`,
    body,
    ctx,
  });
}

/* ── shared shell ───────────────────────────────────────────────────────── */

import { layout as layoutInner } from "./render";
function layoutPage(o: Parameters<typeof layoutInner>[0]): string {
  return layoutInner(o);
}
