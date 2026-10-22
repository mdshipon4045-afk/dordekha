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

  // The commodities that have a price come first in every group: a
  // reader opening the list wants a price, and the ones the source does not
  // report are still there, marked, at the end of their group.
  for (const list of groups.values()) {
    list.sort((a, b) => Number(b.retailAvg !== null) - Number(a.retailAvg !== null));
  }

  // The groups that have prices come first, for the same reason.
  const pricedCount = (list: PriceIndexItem[]) => list.filter((i) => i.retailAvg !== null).length;
  const sections = [...groups.entries()].sort((a, b) => pricedCount(b[1]) - pricedCount(a[1]))
    .map(
      ([group, list]) => `<div style="margin-top:30px">
      <div class="sec-head"><span class="sec-kicker">${esc(group)}</span><h2 style="font-size:22px">${list.length}টি পণ্য</h2></div>
      <div class="sheet">
        <table class="ledger">
          <thead><tr><th scope="col">পণ্য</th><th scope="col">নাম (ইংরেজি)</th><th scope="col" class="n">গড় খুচরা দর</th><th scope="col">একক</th></tr></thead>
          <tbody>${list
            .map(
              (i) => `<tr>
              <td class="c-item"><a href="/price/${esc(i.slug)}">${esc(i.bn)}</a></td>
              <td class="n" style="text-align:left;color:var(--faint);font-family:var(--font-mono);font-size:12.5px">${esc(i.en)}</td>
              <td class="n">${
                i.retailAvg === null
                  ? '<span style="color:var(--faint)">উৎসে এখনো তথ্য নেই</span>'
                  : esc(formatBdt(i.retailAvg))
              }</td>
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
          <thead><tr><th scope="col">তারিখ</th><th scope="col">উদ্ধৃতি</th></tr></thead>
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
