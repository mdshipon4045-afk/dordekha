/**
 * The content pages, held as data and rendered three ways.
 *
 * The audit found that `/methodology.md` and friends returned a 22 KB HTML
 * page to an assistant that had asked for markdown — on exactly the pages
 * where an assistant looks to decide whether it can trust the numbers. The
 * obvious fix is to add markdown renderers, but adding a second copy of
 * every sentence means the two copies drift apart, and a page that says one
 * thing in HTML and another in markdown is worse than a page that says
 * nothing.
 *
 * So the content is written once, as structured data, and rendered into
 * HTML, markdown and JSON from the same source. What a reader sees and what
 * an assistant reads cannot disagree, because there is only one text.
 */

import { esc, formatBdt } from "./render";
import type { RenderContext } from "./render";

/** One block of a content page. */
export type DocSection =
  | {
      kind: "pillars";
      /** The small label above each pillar. */
      items: { kicker: string; title: string; body: string }[];
    }
  | {
      kind: "sheet";
      /** The label on the sheet's bar. */
      label: string;
      /** The label on the right of the sheet's bar. */
      aside: string;
      code: string;
    }
  | {
      kind: "table";
      label: string;
      aside: string;
      head: string[];
      rows: string[][];
    }
  | {
      kind: "prose";
      heading?: string;
      body: string;
    }
  | {
      kind: "callout";
      body: string;
    };

/** A content page. */
export interface Doc {
  /** The path, without the origin. */
  slug: string;
  kicker: string;
  title: string;
  lead: string;
  description: string;
  sections: DocSection[];
  /** Extra fields for the JSON representation. */
  extra?: Record<string, unknown>;
}

/* ── HTML ──────────────────────────────────────────────────────────────────── */

function pillarsHtml(items: { kicker: string; title: string; body: string }[]): string {
  return `<div class="pillars">
  ${items
    .map(
      (p) => `<div class="pillar">
    <div class="num">${esc(p.kicker)}</div>
    <h3>${esc(p.title)}</h3>
    ${p.body
      .split(/\n{2,}/)
      .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
      .join("\n    ")}
  </div>`,
    )
    .join("\n  ")}
</div>`;
}

function sectionHtml(s: DocSection): string {
  switch (s.kind) {
    case "pillars":
      return pillarsHtml(s.items);
    case "sheet":
      return `<div class="sheet">
    <div class="sheet-bar"><span>${esc(s.label)}</span><span>${esc(s.aside)}</span></div>
    <pre><code>${esc(s.code)}</code></pre>
  </div>`;
    case "table":
      return `<div class="sheet">
    <div class="sheet-bar"><span>${esc(s.label)}</span><span>${esc(s.aside)}</span></div>
    <table class="ledger">
      <thead><tr>${s.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${s.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("\n")}</tbody>
    </table>
  </div>`;
    case "prose":
      return `${s.heading ? `<h2>${esc(s.heading)}</h2>` : ""}
    ${s.body
      .split(/\n{2,}/)
      .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
      .join("\n    ")}`;
    case "callout":
      return `<div class="callout">${esc(s.body).replace(/\n/g, "<br>")}</div>`;
  }
}

export function renderDocHtml(doc: Doc, ctx: RenderContext): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}${doc.slug}`;
  const body = `<section class="band">
  <div class="shell">
    <div class="eyebrow"><span class="dot"></span> ${esc(doc.kicker)}</div>
    <h1 style="font-size:clamp(30px,4.8vw,46px)">${esc(doc.title)}</h1>
    <p class="lead">${esc(doc.lead)}</p>
    ${doc.sections.map(sectionHtml).join("\n    ")}
  </div>
</section>`;

  return renderLayout({
    title: `${doc.title} — দরদেখা`,
    description: doc.description,
    canonical,
    body,
    ctx,
    jsonLd: doc.slug === "/dataset" ? datasetJsonLd(doc, canonical) : undefined,
  });
}

function datasetJsonLd(doc: Doc, canonical: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "দরদেখা — বাংলাদেশের দৈনিক কৃষি বাজারদর",
    description:
      "Ministry of Agriculture daily market price reports, unit-normalised and machine-readable.",
    url: canonical,
    creator: { "@type": "Organization", name: "দরদেখা" },
    isBasedOn: ctxSourceNameFallback,
    license: `${canonical.replace(/\/dataset$/, "")}/licence`,
    temporalCoverage: String(doc.extra?.temporalCoverage ?? ""),
    spatialCoverage: "Bangladesh",
    variableMeasured: ["retail price", "wholesale price", "district", "upazila", "commodity"],
  };
}

const ctxSourceNameFallback = "কৃষি মন্ত্রণালয় / কৃষি বিপণন অধিদপ্তর (DAM)";
const SOURCE_REPORT_URL = "https://market.dam.gov.bd/market_daily_price_report";

/* ── Markdown ──────────────────────────────────────────────────────────────── */

export function renderDocMarkdown(doc: Doc, ctx: RenderContext): string {
  const canonical = `${ctx.origin.replace(/\/$/, "")}${doc.slug}`;
  const out: string[] = [
    `# ${doc.title}`,
    "",
    doc.lead,
    "",
    `উৎস: ${ctx.sourceName}`,
    "",
    `সর্বশেষ প্রতিবেদন: ${ctx.latestDate ?? "—"}${ctx.latestDate ? ` (T-1 ভিত্তিক)` : ""}`,
    "",
    `উদ্ধৃতি: ${canonical}`,
    "",
  ];

  for (const s of doc.sections) {
    switch (s.kind) {
      case "pillars":
        out.push(`## ${s.items[0]?.title ?? ""}`.trim());
        out.push("");
        for (const p of s.items) {
          out.push(`### ${p.title}`);
          out.push("");
          out.push(p.body);
          out.push("");
        }
        break;
      case "sheet":
        out.push(`### ${s.label}`);
        out.push("");
        out.push("```");
        out.push(s.code);
        out.push("```");
        out.push("");
        break;
      case "table":
        out.push(`### ${s.label}`);
        out.push("");
        out.push(`| ${s.head.join(" | ")} |`);
        out.push(`|${s.head.map(() => "---").join("|")}|`);
        for (const r of s.rows) out.push(`| ${r.join(" | ")} |`);
        out.push("");
        break;
      case "prose":
        if (s.heading) {
          out.push(`## ${s.heading}`);
          out.push("");
        }
        out.push(s.body);
        out.push("");
        break;
      case "callout":
        out.push(`> ${s.body.replace(/\n/g, "\n> ")}`);
        out.push("");
        break;
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* ── JSON ──────────────────────────────────────────────────────────────────── */

export function renderDocJson(doc: Doc, ctx: RenderContext): unknown {
  const canonical = `${ctx.origin.replace(/\/$/, "")}${doc.slug}`;
  return {
    page: doc.slug,
    title: doc.title,
    lead: doc.lead,
    description: doc.description,
    canonical_url: canonical,
    generated_at: ctx.generatedAt,
    latest_date: ctx.latestDate,
    source: { name: ctx.sourceName, url: SOURCE_REPORT_URL },
    licence: `${ctx.origin.replace(/\/$/, "")}/licence`,
    sections: doc.sections.map((s) => {
      switch (s.kind) {
        case "pillars":
          return { kind: "pillars", items: s.items };
        case "sheet":
          return { kind: "code", label: s.label, aside: s.aside, code: s.code };
        case "table":
          return { kind: "table", label: s.label, aside: s.aside, head: s.head, rows: s.rows };
        case "prose":
          return { kind: "prose", heading: s.heading ?? null, body: s.body };
        case "callout":
          return { kind: "callout", body: s.body };
      }
    }),
    ...(doc.extra ?? {}),
  };
}

/* ── the page builders ─────────────────────────────────────────────────────── */

/** The facts the dataset and methodology pages state. */
export interface DatasetStats {
  /** How many commodities the catalogue holds. */
  commodities: number;
  /** How many of those have published prices. */
  commoditiesWithData: number;
  /** How many districts the catalogue holds. */
  districts: number;
  /** How many of those submitted figures on the latest day. */
  districtsWithData: number;
  /** How many upazilas the source exposes. */
  upazilas: number;
  /** How many report days are held. */
  days: number;
  /** How many rows are held. */
  rows: number;
  /** The share of the latest day's rows carried forward, in percent. */
  carriedPct: number | null;
  firstDate: string | null;
  latestDate: string | null;
  /** The unit legend. */
  units: { id: number; name_bn: string; name_en: string }[];
}

export function datasetDoc(stats: DatasetStats, ctx: RenderContext): Doc {
  const temporal =
    stats.firstDate && stats.latestDate ? `${stats.firstDate}/${stats.latestDate}` : "";

  return {
    slug: "/dataset",
    kicker: "ডেটাসেট",
    title: "ডেটাসেট",
    lead:
      "বাংলাদেশের কৃষি মন্ত্রণালয়ের (কৃষি বিপণন অধিদপ্তর) প্রতিদিনের অনলাইন বাজারদর রিপোর্ট থেকে তৈরি একটি মেশিন-পড়যোগ্য ডেটাসেট। প্রতিটি সংখ্যা উৎস-তারিখসহ রক্ষিত, ইউনিট সংশোধিত এবং যাঁরা জমা দেননি তাদের জন্য স্পষ্ট চিহ্নিত।",
    description:
      "বাংলাদেশের সরকারি দৈনিক কৃষি বাজারদর ডেটাসেট: জেলা, পণ্য, খুচরা ও পাইকারি — কী আছে আর কী নেই, সবই গণনা করা।",
    sections: [
      {
        kind: "table",
        label: "পরিসংখ্যান",
        aside: `পাতা তৈরি ${ctx.generatedAt.slice(0, 10)}`,
        head: ["বিষয়", "মান", "বিবরণ"],
        rows: [
          [
            "পণ্য",
            String(stats.commodities),
            `ক্যাটালগে ${stats.commodities}টি; এর মধ্যে ${stats.commoditiesWithData}টির তথ্য প্রকাশিত`,
          ],
          [
            "জেলা",
            String(stats.districts),
            `এর মধ্যে ${stats.districtsWithData}টি জেলা ${stats.latestDate ?? "সর্বশেষ দিনে"} জমা দিয়েছে`,
          ],
          [
            "উপজেলা",
            String(stats.upazilas),
            stats.upazilas > 0
              ? "উপজেলা-ভিত্তিক তথ্য প্রকাশ করা হচ্ছে"
              : "উপজেলা-ভিত্তিক তথ্য এখনো প্রকাশ করা হয়নি",
          ],
          ["প্রতিবেদনের দিন", String(stats.days), "আর্কাইভ"],
          ["মোট সারি", stats.rows.toLocaleString("en-US"), "খুচরা ও পাইকারি"],
          [
            "পূর্বের মান",
            stats.carriedPct === null ? "—" : `${stats.carriedPct}%`,
            `সর্বশেষ দিনের (${stats.latestDate ?? "—"}) সারিগুলোর মধ্যে যেগুলো আগের দিনের মান পুনরায় ব্যবহার করা হয়েছে`,
          ],
        ],
      },
      {
        kind: "pillars",
        items: [
          {
            kicker: "আছে",
            title: "যা পাবেন",
            body:
              "প্রতিটি পণ্যের খুচরা ও পাইকারি — ন্যূনতম, সর্বোচ্চ ও উৎসের প্রকাশিত মধ্যম-পরিমাণ। জেলা ভিত্তিক তথ্য, ইতিহাস, ইউনিট-সংশোধিত পাইকারি মান, এবং প্রতিটি সারিতে তথ্যের তারিখ ও সতর্কতা-চিহ্ন।",
          },
          {
            kicker: "নেই",
            title: "যা নেই",
            body:
              "সরকারি রিপোর্টে যেসব জেলা বা উপজেলা জমা দেয়নি, সেখানে কোনো মান তৈরি করা হয় না। বাজারের প্রকৃত লেনদেনের দর — এটি সরকারি নজরদারির দর, চুক্তির দর নয়। কোনো অনুমান বা ইন্টারপোলেশন করা হয় না।",
          },
          {
            kicker: "ব্যবহার",
            title: "যেভাবে নেবেন",
            body:
              "REST API, CSV এক্সপোর্ট, MCP server, বা পাতার .md ও .json সংস্করণ। প্রতিটি উত্তরে উৎস, তারিখ ও একটি উদ্ধৃতিযোগ্য URL থাকে।",
          },
        ],
      },
      {
        kind: "callout",
        body:
          "উদ্ধৃতির নিয়ম: উৎস (কৃষি মন্ত্রণালয় / DAM) উল্লেখ করা বাধ্যতামূলক। একটি নির্দিষ্ট তথ্য উদ্ধৃত করতে সেই পাতার canonical URL ব্যবহার করুন — যেমন /price/পণ্য/জেলা/তারিখ। বিস্তারিত: লাইসেন্স পাতা।",
      },
    ],
    extra: {
      temporalCoverage: temporal,
      catalogue_size: stats.commodities,
      commodities_with_data: stats.commoditiesWithData,
      districts_total: stats.districts,
      districts_reporting: stats.districtsWithData,
      upazilas: stats.upazilas,
      report_days: stats.days,
      rows: stats.rows,
    },
  };
}

export function methodologyDoc(stats: DatasetStats, ctx: RenderContext): Doc {
  const carried =
    stats.carriedPct === null
      ? "হিসাব করা যায়নি"
      : `সর্বশেষ দিনের (${stats.latestDate ?? "—"}) মোট ${stats.rows.toLocaleString("en-US")} সারির মধ্যে ${stats.carriedPct}% আগের দিনের মান পুনরায় ব্যবহার করা হয়েছে`;

  const unitRows = stats.units.map((u) => [String(u.id), u.name_bn, u.name_en]);

  return {
    slug: "/methodology",
    kicker: "পদ্ধতি",
    title: "কীভাবে সংখ্যা তৈরি হয়",
    lead:
      "প্রতিটি সংখ্যা কৃষি মন্ত্রণালয়ের অনলাইন বাজারদর রিপোর্ট থেকে সরাসরি নেওয়া। পার্থক্য শুধু তিনটি জায়গায়: ইউনিট ঠিক করা, ফাঁকা (গ্যাপ) স্পষ্ট করা, এবং পুরোনো মান পুনরায় ব্যবহারের ক্ষেত্রে চিহ্নিত করা।",
    description:
      "দরদেখা কীভাবে সরকারি বাজারদরের সংখ্যা সংশোধন ও যাচাই করে: ইউনিট সংশোধন, গ্যাপ-সততা, পুরোনো মান চিহ্নিতকরণ।",
    sections: [
      {
        kind: "pillars",
        items: [
          {
            kicker: "০১",
            title: "ইউনিট সংশোধন",
            body:
              "উৎস ডেটায় পাইকারি মানটি প্রকৃত অনুপাতে লেখা নেই। গম ও শস্যে খুচরা মান প্রতি কেজি, আর পাইকারি মান প্রতি ১০০ কেজির জন্য — অথচ সেটিকে \"কুইন্টাল\" বলা হয়েছে (প্রমাণিত কুইন্টাল ৩৭.৩২ কেজি)।\n\nফলে চাল-আমন-সরু, ঢাকা: খুচরা ৮০ টাকা/কেজি, পাইকারি raw ৭২৫০। ৩৭.৩২ দিয়ে ভাগ করলে ১৯৪ টাকা/কেজি — খুচরার উপরে, অসম্ভব। সঠিক স্কেল ১০০ দিয়ে ভাগ করলে ৭২.৫ টাকা/কেজি — খুচরার নিচে, বাস্তবসম্মত।\n\nপ্রতিটি ইউনিট-জোড়ার গুণক আলাদা: ৪ পিছ → ১০০ পিছ হলে ২৫, ৪ পিছ → ৮০ পিছ হলে ২০। যে গুণক ব্যবহার হয়েছে তা প্রতিটি সারিতে (divisor, divisor_source) সংরক্ষিত থাকে — কোনো সারিতে হাতে-কলমে ১০০ বসানো হয় না।",
          },
          {
            kicker: "০২",
            title: "ফাঁকা (গ্যাপ) সৎভাব",
            body:
              "উৎসে কোনো তারিখে কোনো জেলা জমা দেয়নি, সেখানে কোনো সংখ্যা তৈরি করা হয় না। পরের তারিখের প্রতিবেদন দেখিয়ে চলে যায় না — বরং \"এই তারিখে তথ্য নেই\" বলা হয়, আর যেসব তারিখে তথ্য আছে তা তালিকা দেখানো হয়।",
          },
          {
            kicker: "০৩",
            title: "উৎসের \"গড়\" আসলে মধ্যম-পরিমাণ",
            body:
              "উৎস যে তিনটি সংখ্যা দেয় (ন্যূনতম, সর্বোচ্চ, গড়) — তার তৃতীয়টি ৯৯% সারিতে হুবহু (ন্যূনতম + সর্বোচ্চ) / ২। অর্থাৎ এটি বাজারগুলোর গড় নয়, ব্যাপ্তির মাঝখান। তাই এখানে সেটিকে \"মধ্যম-পরিমাণ\" বলা হয়, এবং JSON-এ is_midpoint: true আছে। যেসব সারিতে উৎসের গড় তার নিজের ব্যাপ্তির বাইরে পড়েছে, সেগুলো ব্যাপ্তির ভেতরে সংশোধন করে দেখানো হয় এবং anomaly-তে লেখা থাকে — উৎসের আসল সংখ্যাটিও (source_avg) লুকানো হয় না।",
          },
          {
            kicker: "০৪",
            title: "পুরোনো মান চিহ্নিত",
            body: `পূর্বের দিনের মান পুনরায় ব্যবহার করা হলে সারিতে carried_forward: true থাকে এবং পাতায় \"পূর্বের\" ছাপ লাগে। ${carried}। এই হারটি হাতে-কলমে লেখা নয় — প্রতিটি অনুরোধে ডেটা থেকে গোনা হয়।`,
          },
        ],
      },
      {
        kind: "table",
        label: "ইউনিট কোড",
        aside: "REST API-তে unit নামে এই কোডটি আসে",
        head: ["কোড", "নাম (বাংলা)", "নাম (English)"],
        rows: unitRows,
      },
      {
        kind: "callout",
        body:
          "যা আমরা করি না: কোনো মান অনুমান করি না, কোনো তারিখের তথ্য পরের দিনে সরাই না, আর কোনো সংখ্যাকে উৎসের চেয়ে বেশি নিখুঁত করি না।",
      },
    ],
  };
}

export function licenceDoc(ctx: RenderContext): Doc {
  return {
    slug: "/licence",
    kicker: "লাইসেন্স",
    title: "লাইসেন্স ও ব্যবহারের শর্ত",
    lead:
      "দরদেখা ডেটা মূলত সরকারি উৎস থেকে নেওয়া। উপরের লাইসেন্সটি আমাদের নিজস্ব প্রক্রিয়াগত অবস্থান — বাণিজ্যিক ব্যবহারের আগে কৃষি বিপণন অধিদপ্তরের সঙ্গে লাইসেন্স/সমচ্ছেদ বিষয়ে যোগাযোগ করা হয়।",
    description: "দরদেখা ডেটার ব্যবহারের শর্ত: ব্যক্তিগল ও গবেষণার ব্যবহার, এবং বাণিজ্যিক ব্যবহারের লাইসেন্স।",
    sections: [
      {
        kind: "pillars",
        items: [
          {
            kicker: "০১",
            title: "ব্যক্তিগল ও গবেষণা",
            body:
              "ব্যক্তিগত পরিচয়, গবেষণা, শিক্ষা ও সংবাদ-পত্রের ব্যবহারের জন্য তথ্য নেওয়া ও প্রকাশ করা যায়। উৎস (কৃষি মন্ত্রণালয় / DAM) উল্লেখ করা বাধ্যতামূলক।",
          },
          {
            kicker: "০২",
            title: "বাণিজ্যিক ব্যবহার",
            body:
              "বাণিজ্যিক ব্যবহার (অ্যাপ, এন্টারপ্রাইজ ইন্টিগ্রেশন, পুনঃবিতরণ) একটি লাইসেন্সের অধীনে। ধরন: বাণিজ্যিক ব্যবহারের অনুমতি, API, অ্যালার্ট ও বাল্ক ডেটা এক্সপোর্ট।",
          },
          {
            kicker: "০৩",
            title: "দায়বশীমতা",
            body:
              "তথ্য সরকারি রিপোর্টের নিবন্ধনের উপর ভিত্তি করে দেওয়া হয়েছে। ভুল ব্যাখ্যা, অসম্পূর্ণ উপস্থাপন, অথবা মূল উৎসের পরিবর্তন ছাড়া ব্যবহার নিষিদ্ধ।",
          },
        ],
      },
      {
        kind: "sheet",
        label: "REST API",
        aside: "টাকা প্রতি মাস",
        code: `GET /api/v1/latest?district=47
GET /api/v1/price?commodity=পেঁয়াজ&district=পাবনা
GET /api/v1/series.csv?commodity=602&district=47
GET /api/v1/search?q=পেঁয়াজ ঢাকা`,
      },
    ],
  };
}

export function apiDoc(ctx: RenderContext): Doc {
  return {
    slug: "/api",
    kicker: "ডেভেলপার",
    title: "API ও MCP",
    lead:
      "দরদেখার তথ্য REST API, CSV এক্সপোর্ট ও MCP server — তিনভাবে পাওয়া যায়। প্রতিটি উত্তরে উৎস, তারিখ ও একটি উদ্ধৃতিযোগ্য URL থাকে।",
    description:
      "দরদেখার REST API, CSV এক্সপোর্ট ও MCP server — AI সহকারীর জন্য মেশিন-পড়যোগ্য বাজারদর।",
    sections: [
      {
        kind: "sheet",
        label: "REST",
        aside: "application/json",
        code: `GET /api/v1/latest?district=47          (জেলা আইডি বা নাম)
GET /api/v1/price?commodity=পেঁয়াজ&district=পাবনা
GET /api/v1/price?commodity=পেঁয়াজ&district=ঢাকা&date=2026-10-19
GET /api/v1/search?q=পেঁয়াজ ঢাকা
GET /api/v1/answer?q=পেঁয়াজ ঢাকা
GET /api/v1/series.csv?commodity=602&district=47
GET /api/v1/districts
GET /api/v1/commodities
GET /api/v1/units`,
      },
      {
        kind: "sheet",
        label: "MCP server",
        aside: "stateless · 2026-07-28",
        code: `POST ${ctx.origin.replace(/\/$/, "")}/mcp
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28

{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
      },
      {
        kind: "prose",
        body:
          "টুল: get_market_price · compare_districts · get_price_trend · verify_claim। প্রতিটি ফলাফলে url থাকে, যা অ্যাসিস্ট্যান্টের উত্তরে ক্লিকযোগ্য উৎস হিসেবে দেখায়। প্রতিটি ফলাফলে price_date, unit_bn এবং প্রতিটি সারির নিজস্ব url-ও থাকে।",
      },
      {
        kind: "sheet",
        label: "বিকল্প ফরম্যাট",
        aside: "text/markdown · application/json",
        code: `GET /price/পণ্য/জেলা/তারিখ.md
GET /price/পণ্য/জেলা/তারিখ.json
GET /methodology.md
GET /dataset.json

# অথবা Accept হেডারে
curl -H "Accept: text/markdown"  /price/পণ্য/জেলা/তারিখ
curl -H "Accept: application/json" /price/পণ্য/জেলা/তারিখ`,
      },
      {
        kind: "callout",
        body:
          "দ্রুত পরীক্ষা: /api/v1/latest?district=47 — উত্তরে প্রতিটি সারিতে price_date, unit_bn, is_midpoint এবং সেই সংখ্যাটির উদ্ধৃতিযোগ্য url থাকে।",
      },
    ],
  };
}

/**
 * The pricing page.
 *
 * The audit's business review found one thing that was missing entirely: a
 * page a potential customer could look at. There was a licence page, an API
 * page and a dataset page, but nothing that said what the product costs and
 * how to buy it — so the commercial offer existed only in a plan file
 * nobody outside the project could read.
 *
 * The prices are the same ones the plan has always carried. Nothing is
 * invented here, and the licence status is stated plainly rather than
 * implied away.
 */
export function pricingDoc(ctx: RenderContext): Doc {
  return {
    slug: "/pricing",
    kicker: "মূল্য",
    title: "মূল্য ও কীভাবে কেনা যায়",
    lead:
      "দরদেখার সংখ্যা সবার জন্য উন্মুক্ত — সেটি বদলাবে না। টাকা লাগে শুধু উন্নত সেবার জন্য: বাণিজ্যিক API, পূর্ণ ইতিহাসের বাল্ক ডেটা, প্রতিদিনের অ্যালার্ট ও MCP server।",
    description:
      "দরদেখার মূল্য: বিনা টাকায় উন্মুক্ত ডেটা ও API, বাণিজ্যিক API লাইসেন্স, বাল্ক এক্সপোর্ট ও প্রতিদিনের অ্যালার্ট।",
    sections: [
      {
        kind: "table",
        label: "পরিকল্পনা",
        aside: "টাকা প্রতি মাস, বাংলাদেশি টাকায়",
        head: ["পরিকল্পনা", "মূল্য", "যা পাবেন"],
        rows: [
          [
            "উন্মুক্ত",
            "৳০",
            "ওয়েবসাইটের সব পাতা, প্রতিটি তথ্যের পার্মালিংক, `.md` ও `.json` সংস্করণ, MCP server, সীমিত REST API, ডেটাসেট ও পদ্ধতির নথি",
          ],
          [
            "বাণিজ্যিক API",
            "৳২,০০০",
            "API key, বাণিজ্যিক ব্যবহারের লাইসেন্স, রেট-লিমিট ও কোটা, উচ্চতর নির্ভরযোগ্যতা, ইমেইলে সাপোর্ট",
          ],
          [
            "বাল্ক ডেটা",
            "৳১০,০০০",
            "পূর্ণ ইতিহাসের CSV/JSON এক্সপোর্ট (৬৪ জেলা × সব পণ্য × সব প্রতিবেদনের দিন), কাস্টম সীমা, ফাইল বা S3 লিংকে",
          ],
          [
            "অ্যালার্ট",
            "৳৫০০",
            "নির্দিষ্ট পণ্য ও জেলার দর প্রতিদিন পরিবর্তন হলে টেলিগ্রামে ও ওয়েবহুকে সতর্কতা",
          ],
          [
            "MCP server",
            "৳৩,০০০",
            "আপনার AI সহকারীর জন্য বাণিজ্যিক ব্যবহার, প্রতিটি ফলাফলে আপনার উদ্ধৃতি URL, উচ্চ কোটা",
          ],
          ["এন্টারপ্রাইজ", "প্রতিবেদন", "একাধিক জেলা, SLA, নির্দিষ্ট স্কিমা, বকেয়া ব্যবস্থাপত্তা"],
        ],
      },
      {
        kind: "pillars",
        items: [
          {
            kicker: "০১",
            title: "যা সবসময় ফ্রি থাকবে",
            body:
              "ওয়েবসাইটের সব পাতা, প্রতি-তথ্যের পার্মালিংক, Markdown ও JSON সংস্করণ, MCP server, এবং REST API-এর সাধারণ ব্যবহার। এগুলো বাণিজ্যিকভাবেও ফ্রি — আমরা সংখ্যা বিক্রি করি না, সেবা বিক্রি করি।",
          },
          {
            kicker: "০২",
            title: "আমরা কী দিই না",
            body:
              "আমরা কোনো সংখ্যা ফ্যাক্টরি বা অনুমানভিত্তিক ডেটা বিক্রি করি না। যে সারি আপনি কিনবেন, সেটি উৎসের সঙ্গে হুবহু মিলিয়ে যাচাই করা যাবে — প্রতিটি সারিতে তারিখ, উৎস ও ইউনিট-গুণক সংরক্ষিত।",
          },
          {
            kicker: "০৩",
            title: "লাইসেন্সের অবস্থা",
            body:
              "কৃষি বিপণন অধিদপ্তরের সঙ্গে তথ্য-ব্যবহারের লাইসেন্সের আবেদন চলছে। লাইসেন্স চালু হওয়ার আগে আমরা কোনো বাণিজ্যিক ফি নিই না — এই ধাপে কেউ চাইলে বিনা টাকায় পাইলট ফি নিতে পারে।",
          },
        ],
      },
      {
        kind: "sheet",
        label: "যোগাযোগ",
        aside: "উত্তর ২৪ ঘণ্টার মধ্যে",
        code: `bKash (ব্যক্তিগত): 01730534955
ইমেইল: অনুরোধের সাথে আসবে
ওয়েবসাইট: ${ctx.origin.replace(/\/$/, "")}

যা লিখুন:
  ১. কী লাগবে (API / বাল্ক / অ্যালার্ট / MCP)
  ২. কত জেলা ও কত পণ্য
  ৩. কত ঘণ্টা পরিবর্তনের সতর্কতা দরকার
  ৪. (ঐচ্ছিক) আপনার API key-এর বা ওয়েবহুকের ঠিকানা`,
      },
      {
        kind: "callout",
        body:
          "দ্রুত পরীক্ষা করতে চান? MCP serverটি এখনই চালু — কোনো চাবি লাগে না। পরীক্ষা করে সিদ্ধান্ত নিতে চাইলে ইমেইল করুন, ফ্রি পাইলট চালু করে দেব।",
      },
    ],
  };
}

/* ── the shared layout ─────────────────────────────────────────────────────── */
import { layout as layoutInner } from "./render";
function renderLayout(o: Parameters<typeof layoutInner>[0]): string {
  return layoutInner(o);
}

/* ── helpers used by the page builders ────────────────────────────────────── */

/** A comma-grouped number in Bangla digits, for the tables. */
export function bnNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)] ?? d);
}

/** A price for a table cell. */
export function bnPrice(n: number | null): string {
  return n === null ? "—" : formatBdt(n);
}
