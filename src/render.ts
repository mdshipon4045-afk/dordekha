/**
 * Rendering: one canonical set of facts, three representations.
 *
 *   text/html        → humans, and the surface AI crawlers read
 *   text/markdown    → agents that ask for markdown
 *   application/json → machines
 *
 * DESIGN DIRECTION — "খাতা" (the ledger)
 * -----------------------------------------
 * The visual language comes from the shop ledger this data replaces: a
 * ruled register with a red margin rule, ink columns, a brass balance
 * scale, and corners that are square because printed forms have square
 * corners. It is a cool register-paper ground (not warm cream), deep indigo
 * (the colour Bengal is named for), the red of ledger ink, and the brass of
 * a market scale.
 *
 * The signature element is "আজকের খাতা" — a live ledger sheet whose last
 * column is separated by that red rule and stamps every row with whether
 * the figure was freshly reported or carried forward from the previous day.
 * Honesty is the product, so the page is built around showing it.
 *
 * Two things matter most for being cited: the title must answer the
 * question, and the first paragraph must contain the numbers.
 */

import { formatBdt, toBanglaDigits } from "./normalize";
import { LOGO_SVG, ledgerFigure } from "./brand";
import type { PriceRowOut } from "./db";

export interface RenderContext {
  origin: string;
  sourceName: string;
  latestDate: string | null;
  generatedAt: string;
  /** Count of rows currently stored, for the statistics strip. */
  rowCount?: number;
  dayCount?: number;
  commodityCount?: number;
  districtCount?: number;
}

const ESC: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

export function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

/* ──────────────────────────────────────────────────────────────────────────
   Design tokens & base styles
   ────────────────────────────────────────────────────────────────────────── */

const CSS = `
:root{
  --paper:#eef1f7; --paper-2:#ffffff; --paper-3:#e6ebf5; --paper-4:#dfe5f1;
  --ink:#131a2e; --ink-2:#3a4566; --muted:#6b769a; --faint:#9aa3bd;
  --rule:#ccd5e8; --rule-soft:#e1e7f2;
  --red:#b52b2b; --red-soft:#fbecec; --red-line:#e3b8b8;
  --indigo:#2a3a6b; --indigo-soft:#e7ebf5;
  --brass:#96702a; --brass-soft:#f6efdd;
  --green:#2c6b3d; --green-soft:#e6f1e9;
  --font-display:"Tiro Bangla","Noto Serif Bengali",Georgia,"Times New Roman",serif;
  --font-body:"Anek Bangla","Hind Siliguri",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --r:3px;
  --shell:1180px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scrollbar-gutter:stable}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font-family:var(--font-body);font-size:17px;line-height:1.7;
  font-weight:380;
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
a{color:var(--indigo);text-decoration:none;border-bottom:1px solid transparent}
a:hover{border-bottom-color:currentColor}
h1,h2,h3{font-family:var(--font-display);font-weight:400;line-height:1.28;letter-spacing:-.01em;margin:0}
img,svg{max-width:100%}
code,kbd{font-family:var(--font-mono);font-size:.86em}
.shell{max-width:var(--shell);margin:0 auto;padding:0 22px}

/* ── skip link ────────────────────────────────────────────────────────── */
/* Hidden from the page, but reachable by keyboard: a keyboard user must be
   able to jump past the navigation. Standard pattern — visually hidden
   until focused. */
.skip{
  position:absolute;left:-9999px;top:0;width:1px;height:1px;padding:0;margin:0;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;
}
.skip:focus{
  position:fixed;left:14px;top:12px;z-index:200;width:auto;height:auto;
  clip:auto;overflow:visible;background:var(--ink);color:var(--paper-2);
  padding:10px 16px;border-radius:var(--r);font-size:15px;text-decoration:none;
}

/* ── masthead ─────────────────────────────────────────────────────────── */
.masthead{
  position:sticky;top:0;z-index:50;background:rgba(238,241,247,.93);
  backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--rule);
}
.masthead-in{display:flex;align-items:center;gap:22px;height:52px}
.brand{display:flex;align-items:center;gap:8px;color:var(--ink);font-family:var(--font-display);font-size:19px;border:0;white-space:nowrap}
.brand:hover{border:0}
.brand-mark{display:block;width:24px;height:24px;flex:0 0 24px}
.brand-mark svg{display:block;width:100%;height:100%}
.brand-sub{font-family:var(--font-mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--faint);border-left:1px solid var(--rule);padding-left:8px;margin-left:1px;white-space:nowrap}
.nav{display:flex;gap:18px;margin-left:auto;align-items:center;flex-wrap:nowrap;min-width:0}
.nav a{color:var(--ink-2);font-size:14.5px;font-weight:450;border:0;padding:3px 0;white-space:nowrap}
.nav a:hover{color:var(--red);border:0}
/* The mobile menu button. Hidden on wide screens, where the links are
   already visible. */
.nav-toggle{
  display:none;margin-left:auto;width:40px;height:34px;align-items:center;justify-content:center;
  background:transparent;border:1px solid var(--rule);border-radius:var(--r);cursor:pointer;color:var(--ink);
}
.nav-toggle span{display:block;width:16px;height:1.5px;background:currentColor;position:relative}
.nav-toggle span::before,.nav-toggle span::after{
  content:"";position:absolute;left:0;width:16px;height:1.5px;background:currentColor;
}
.nav-toggle span::before{top:-5px}
.nav-toggle span::after{top:5px}
.nav-toggle[aria-expanded="true"]{background:var(--ink);color:var(--paper-2);border-color:var(--ink)}
.nav-cta{
  font-family:var(--font-mono);font-size:11.5px;letter-spacing:.06em;
  border:1px solid var(--ink);background:var(--ink);color:var(--paper-2);
  padding:6px 11px;border-radius:var(--r);border-bottom:1px solid var(--ink);white-space:nowrap;
}
.nav-cta:hover{background:var(--indigo);border-color:var(--indigo);color:#fff}

/* ── hero ─────────────────────────────────────────────────────────────── */
.hero{padding:40px 0 32px;border-bottom:1px solid var(--rule)}
.hero-grid{display:grid;grid-template-columns:minmax(0,1fr) 296px;gap:40px;align-items:start}
.eyebrow{
  font-family:var(--font-mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;
  color:var(--muted);display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:16px;
}
.eyebrow .dot{width:5px;height:5px;background:var(--red);border-radius:50%;flex:0 0 5px}
.hero h1{font-size:clamp(36px,5.2vw,60px);line-height:1.06;letter-spacing:-.025em}
.hero h1 em{font-style:normal;color:var(--red)}
.lead{font-size:18px;line-height:1.58;color:var(--ink-2);max-width:56ch;margin:16px 0 0;font-weight:360}
.lead b{font-weight:600;color:var(--ink)}
.stamp-note{
  font-family:var(--font-mono);font-size:12px;letter-spacing:.02em;color:var(--muted);
  margin:12px 0 0;padding-left:11px;border-left:2px solid var(--rule);
}
.stamp-note strong{color:var(--ink-2);font-weight:500}
.ledger-figure{width:100%;height:auto;display:block;margin-top:6px}
.figure-cap{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);text-align:center;margin-top:10px}

/* ── the search module (the hero thesis) ──────────────────────────────── */
.lookup{
  margin:34px 0 0;border:1px solid var(--rule);border-left:3px solid var(--red);
  background:var(--paper-2);border-radius:var(--r);
  box-shadow:0 1px 0 rgba(19,26,46,.04),0 14px 34px -26px rgba(19,26,46,.4);
}
.lookup-label{
  font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);padding:13px 18px 0;
}
.lookup-form{display:flex;gap:0;flex-wrap:wrap;align-items:stretch;padding:9px 10px 11px}
.lookup-form input{
  flex:1 1 190px;min-width:0;border:1px solid var(--rule);background:var(--paper);
  border-radius:var(--r);padding:12px 14px;font-family:var(--font-body);font-size:16.5px;color:var(--ink);
}
.lookup-form input::placeholder{color:var(--faint)}
.lookup-form input:focus{outline:2px solid var(--indigo);outline-offset:1px;background:#fff}
.lookup-form button{
  flex:0 0 auto;border:1px solid var(--ink);background:var(--ink);color:var(--paper-2);
  font-family:var(--font-body);font-size:16px;font-weight:550;padding:12px 22px;border-radius:var(--r);
  cursor:pointer;margin-left:8px;
}
.lookup-form button:hover{background:var(--red);border-color:var(--red)}
.lookup-answer{padding:0 18px 16px;display:none}
.lookup-answer.on{display:block}
.lookup-answer .ans{
  border-top:1px solid var(--rule-soft);padding-top:14px;display:flex;gap:22px;flex-wrap:wrap;align-items:baseline;
}
.lookup-answer .big{font-family:var(--font-display);font-size:30px;color:var(--ink)}
.lookup-answer .meta{color:var(--muted);font-size:14px}
.lookup-answer .meta code{background:var(--paper-3);padding:1px 6px;border-radius:var(--r);color:var(--ink-2)}
.lookup-answer .err{color:var(--red);font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}
.chip{
  font-size:14px;color:var(--ink-2);background:var(--paper-3);border:1px solid var(--rule-soft);
  padding:5px 11px;border-radius:var(--r);cursor:pointer;
}
.chip:hover{background:var(--paper-4);color:var(--ink);border-color:var(--rule)}
.chip::before{content:"“";color:var(--faint)}
.chip::after{content:"”";color:var(--faint)}

/* ── statistics strip ─────────────────────────────────────────────────── */
.stats{
  display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--rule);
  border-top:0;background:var(--paper-2);border-radius:0 0 var(--r) var(--r);overflow:hidden;
}
.stat{padding:17px 20px;border-right:1px solid var(--rule-soft)}
.stat:last-child{border-right:0}
.stat .n{font-family:var(--font-display);font-size:29px;line-height:1.1;color:var(--ink)}
.stat .n small{font-size:15px;color:var(--muted);font-family:var(--font-body);margin-left:3px}
.stat .l{font-size:13.5px;color:var(--muted);margin-top:2px}

/* ── sections ─────────────────────────────────────────────────────────── */
section.band{padding:56px 0;border-bottom:1px solid var(--rule)}
.sec-head{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.sec-head h2{font-size:clamp(26px,3.6vw,35px)}
.sec-kicker{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--red)}
.sec-note{color:var(--muted);font-size:15.5px;max-width:70ch;margin:10px 0 26px}

/* ── the ledger sheet (signature) ─────────────────────────────────────── */
.sheet{border:1px solid var(--rule);background:var(--paper-2);border-radius:var(--r);overflow:hidden}
.sheet-bar{
  display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;
  padding:11px 18px;border-bottom:1px solid var(--rule);background:var(--paper-3);
  font-family:var(--font-mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);
}
table.ledger{width:100%;border-collapse:collapse;font-size:15.5px}
table.ledger th{
  text-align:left;font-weight:500;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);padding:11px 16px;border-bottom:1px solid var(--rule);background:var(--paper-2);
  font-family:var(--font-mono);
}
table.ledger td{padding:11px 16px;border-bottom:1px solid var(--rule-soft);vertical-align:baseline}
table.ledger tbody tr:last-child td{border-bottom:0}
table.ledger tbody tr:hover{background:var(--paper-3)}
table.ledger .c-item{font-weight:450}
table.ledger .c-item a{color:var(--ink);border:0}
table.ledger .c-item a:hover{color:var(--red)}
table.ledger .c-item .en{color:var(--faint);font-size:13px;margin-left:7px;font-family:var(--font-mono)}
table.ledger .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table.ledger th.n{text-align:right}
table.ledger .c-prov{
  border-left:2px solid var(--red-line);font-family:var(--font-mono);font-size:12px;color:var(--muted);
  white-space:nowrap;width:1%;
}
.stamp{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:2px;white-space:nowrap}
.stamp.fresh{color:var(--green);background:var(--green-soft)}
.stamp.carry{color:var(--brass);background:var(--brass-soft)}
.sheet-more{display:block;padding:13px 18px;border-top:1px solid var(--rule);background:var(--paper-3);font-size:14.5px}

/* ── pillars ──────────────────────────────────────────────────────────── */
.pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:var(--r);overflow:hidden}
.pillar{background:var(--paper-2);padding:24px 22px}
.pillar .num{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;color:var(--red);margin-bottom:9px}
.pillar h3{font-size:19px;margin-bottom:8px}
.pillar p{margin:0;font-size:15px;color:var(--ink-2);line-height:1.62}
.pillar code{background:var(--paper-3);padding:1px 5px;border-radius:2px;color:var(--ink)}

/* ── movers ───────────────────────────────────────────────────────────── */
.movers{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:var(--r);overflow:hidden}
.mover{background:var(--paper-2);padding:20px 20px 18px}
.mover .c{font-weight:500;margin-bottom:2px}
.mover .d{font-family:var(--font-mono);font-size:11px;color:var(--faint);margin-bottom:11px}
.mover .v{display:flex;align-items:baseline;gap:10px}
.mover .v .now{font-family:var(--font-display);font-size:25px}
.mover .v .was{color:var(--faint);font-size:14px;text-decoration:line-through;font-variant-numeric:tabular-nums}
.mover .v .ch{margin-left:auto;font-family:var(--font-mono);font-size:13px;padding:2px 7px;border-radius:2px}
.ch.up{color:var(--red);background:var(--red-soft)}
.ch.dn{color:var(--green);background:var(--green-soft)}
.ch.flat{color:var(--muted);background:var(--paper-3)}

/* ── steps (a real sequence, so numbering is meaningful) ─────────────── */
.steps{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1px solid var(--rule);border-radius:var(--r);overflow:hidden;background:var(--paper-2)}
.step{padding:20px 18px;border-right:1px solid var(--rule-soft);position:relative}
.step:last-child{border-right:0}
.step .n{font-family:var(--font-mono);font-size:11px;color:var(--red);letter-spacing:.1em;margin-bottom:7px}
.step h3{font-size:16.5px;margin-bottom:6px;font-family:var(--font-body);font-weight:550;line-height:1.4}
.step p{font-size:14px;color:var(--ink-2);margin:0;line-height:1.58}

/* ── code ─────────────────────────────────────────────────────────────── */
pre{
  background:var(--ink);color:#dde5f4;border-radius:var(--r);padding:16px 18px;overflow-x:auto;
  font-family:var(--font-mono);font-size:13px;line-height:1.65;margin:0;
}
pre .c{color:#8fa3c8}
pre .k{color:#e0a3a3}

/* ── forms ────────────────────────────────────────────────────────────── */
.field{
  display:block;width:100%;border:1px solid var(--rule);background:var(--paper-2);border-radius:var(--r);
  padding:12px 14px;font-family:var(--font-body);font-size:16.5px;color:var(--ink);
}
.field:focus{outline:2px solid var(--indigo);outline-offset:1px}
.btn{
  display:inline-block;border:1px solid var(--ink);background:var(--ink);color:var(--paper-2);
  font-family:var(--font-body);font-size:16px;font-weight:500;padding:12px 22px;border-radius:var(--r);
  cursor:pointer;border-bottom:1px solid var(--ink);
}
.btn:hover{background:var(--red);border-color:var(--red);color:#fff}

/* ── footer ───────────────────────────────────────────────────────────── */
footer{border-top:2px solid var(--ink);margin-top:20px;background:var(--paper-2)}
.foot-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:34px;padding:44px 0 34px}
.foot-brand{display:flex;align-items:center;gap:9px;font-family:var(--font-display);font-size:19px;margin-bottom:12px}
.foot-brand .brand-mark{width:25px;height:25px;flex:0 0 25px}
.foot p{color:var(--muted);font-size:14.5px;margin:0 0 8px;max-width:34ch}
.foot h4{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);margin:0 0 12px;font-weight:500}
.foot ul{list-style:none;margin:0;padding:0}
.foot li{margin-bottom:7px}
.foot li a{color:var(--ink-2);font-size:14.5px}
.foot li a:hover{color:var(--red)}
.foot-bar{
  border-top:1px solid var(--rule);padding:16px 0 26px;display:flex;gap:16px;flex-wrap:wrap;
  align-items:center;font-family:var(--font-mono);font-size:11.5px;color:var(--faint);letter-spacing:.03em;
}
.foot-bar .sep{color:var(--rule)}
.foot-bar a{color:var(--muted)}
.foot-bar a:hover{color:var(--red)}

.callout{
  border:1px solid var(--rule);border-left:3px solid var(--brass);background:var(--brass-soft);
  border-radius:var(--r);padding:15px 18px;font-size:15px;color:var(--ink-2);
}
.callout b{color:var(--ink)}

@media (max-width:900px){
  .hero-grid{grid-template-columns:1fr;gap:26px}
  .ledger-figure{max-width:296px;margin:0 auto}
  .stats{grid-template-columns:repeat(2,1fr)}
  .stat:nth-child(2n){border-right:0}
  .stat:nth-child(-n+2){border-bottom:1px solid var(--rule-soft)}
  .pillars,.movers{grid-template-columns:1fr}
  .steps{grid-template-columns:1fr 1fr}
  .step{border-bottom:1px solid var(--rule-soft)}
  .foot-grid{grid-template-columns:1fr 1fr}
  .brand-sub{display:none}
}
@media (max-width:620px){
  body{font-size:16px}
  .shell{padding:0 16px}
  .nav-toggle{display:inline-flex}
  .nav{
    display:none;position:absolute;left:0;right:0;top:100%;z-index:40;
    flex-direction:column;align-items:stretch;gap:0;background:var(--paper-2);
    border-bottom:1px solid var(--rule);padding:6px 16px 14px;
  }
  .nav.open{display:flex}
  .nav a:not(.nav-cta){display:block;padding:11px 0;border-bottom:1px solid var(--rule-soft);font-size:16px}
  .nav .nav-cta{display:inline-block;margin-top:12px;align-self:flex-start}
  .hero{padding:30px 0 24px}
  .steps{grid-template-columns:1fr}
  .foot-grid{grid-template-columns:1fr}
  .lookup-form button{margin-left:0;margin-top:8px;width:100%}
  table.ledger{font-size:14px}
  table.ledger th,table.ledger td{padding:9px 10px}
  table.ledger .c-item .en{display:none}
}
@media (prefers-reduced-motion:no-preference){
  .ledger-reveal{animation:rise .5s cubic-bezier(.2,.7,.3,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
}
/* A visible focus ring on everything that can be focused. The audit found
   none: a keyboard user could not tell where they were. */
:focus-visible{
  outline:2px solid var(--indigo);
  outline-offset:2px;
  border-radius:2px;
}
a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--indigo);outline-offset:2px}
.skip:focus-visible{outline:3px solid var(--red);outline-offset:2px}
`;

/* ──────────────────────────────────────────────────────────────────────────
   Page shell
   ────────────────────────────────────────────────────────────────────────── */

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
<meta property="og:site_name" content="দরদেখা">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.svg">
<link rel="alternate" type="text/markdown" href="${esc(canonical)}.md">
<link rel="alternate" type="application/json" href="${esc(canonical)}.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tiro+Bangla:ital@0;1&family=Anek+Bangla:wght@300..800&family=IBM+Plex+Mono:wght@400;500&display=swap">
${jsonLdBlock}${opts.extraHead ?? ""}
<style>${CSS}</style>
</head>
<body>
<a href="#main" class="skip">সরাসরি কনটেন্টে যান</a>
<header class="masthead">
  <div class="shell masthead-in">
    <a class="brand" href="/">
      <span class="brand-mark">${LOGO_SVG}</span>
      <span>দরদেখা</span>
      <span class="brand-sub">market ledger</span>
    </a>
    <nav class="nav" id="nav">
      <a href="/price">পণ্য</a>
      <a href="/dataset">ডেটাসেট</a>
      <a href="/methodology">পদ্ধতি</a>
      <a href="/api">API</a>
      <a href="/pricing">মূল্য</a>
      <a href="/verify">যাচাই</a>
      <a class="nav-cta" href="/mcp">MCP</a>
    </nav>
    <button class="nav-toggle" id="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="মেনু খুলুন"><span></span></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="shell">
    <div class="foot-grid">
      <div class="foot">
        <div class="foot-brand"><span class="brand-mark">${LOGO_SVG}</span><span>দরদেখা</span></div>
        <p>বাংলাদেশের সরকারি কৃষি বাজারদর, প্রতিদিন — ইউনিট সংশোধিত, উৎসসহ, যাচাইযোগ্য।</p>
        <p>কোনো নতুন সংখ্যা বানানো হয় না — উৎস যা দেয় তাই প্রকাশ করা হয়। যেখানে উৎসে তথ্য নেই, সেখানে ফাঁকা থাকে।</p>
      </div>
      <div class="foot">
        <h4>ডেটা</h4>
        <ul>
          <li><a href="/">আজকের খাতা</a></li>
          <li><a href="/price">সব পণ্য</a></li>
          <li><a href="/district/dhaka">ঢাকা জেলা</a></li>
          <li><a href="/dataset">ডেটাসেট বিবরণ</a></li>
          <li><a href="/methodology">পদ্ধতি</a></li>
        </ul>
      </div>
      <div class="foot">
        <h4>ডেভেলপার</h4>
        <ul>
          <li><a href="/api">REST API</a></li>
          <li><a href="/mcp">MCP server</a></li>
          <li><a href="/pricing">মূল্য</a></li>
          <li><a href="/licence">লাইসেন্স</a></li>
          <li><a href="/llms.txt">llms.txt</a></li>
        </ul>
      </div>
      <div class="foot">
        <h4>যোগাযোগ ও উৎস</h4>
        <ul>
          <li><a href="/verify">দাবি যাচাই করুন</a></li>
          <li><a href="/health">সার্ভিসের অবস্থা</a></li>
        </ul>
        <p>উৎস: ${esc(ctx.sourceName)}</p>
        <p>সর্বশেষ প্রতিবেদন: <strong>${esc(ctx.latestDate ?? "—")}</strong></p>
      </div>
    </div>
    <div class="foot-bar">
      <span>দরদেখা</span><span class="sep">·</span>
      <span>উৎস: কৃষি মন্ত্রণালয় / DAM</span><span class="sep">·</span>
      <span>লাইসেন্স</span><span class="sep">·</span>
      <span>সর্বশেষ প্রতিবেদন ${esc(ctx.latestDate ?? "—")}</span><span class="sep">·</span>
      <span>উৎস উল্লেখ করে ব্যবহার করুন</span>
    </div>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────────────────────
   Home
   ────────────────────────────────────────────────────────────────────────── */

export interface LedgerRow {
  commodityBn: string;
  commodityEn: string;
  commoditySlug: string;
  districtBn: string;
  districtSlug: string;
  retail: { min: number | null; max: number | null; avg: number | null; unitBn: string } | null;
  wholesale: { min: number | null; max: number | null; avg: number | null } | null;
  carriedForward: boolean;
  date: string;
  url: string;
}

export interface MoverRow {
  commodityBn: string;
  districtBn: string;
  now: number | null;
  was: number | null;
  changePct: number | null;
}

export interface HomeData {
  latestDate: string | null;
  previousDate: string | null;
  /** Which district the ledger sheet below is showing, and why. */
  ledgerDistrict: string;
  ledger: LedgerRow[];
  movers: MoverRow[];
  carriedPct: number | null;
  commodityCount: number;
  /** How many of those commodities actually have published prices. */
  commoditiesWithData: number;
  districtCount: number;
  rowCount: number;
  dayCount: number;
}

const SAMPLE_QUERIES = [
  "আজ পেঁয়াজের দাম কত",
  "আজ ডিমের দাম কত",
  "আজ চালের দাম কত",
  "আজ আলুর দাম কত",
  "আজ সয়াবিন তেলের দাম কত",
];

export function renderHomeHtml(d: HomeData, ctx: RenderContext): string {
  const title = "আজকের বাজারদর — বাংলাদেশ, প্রতিদিন, সরকারি তথ্য";
  const description = `বাংলাদেশের ${d.districtCount}টি জেলা ও ${d.commodityCount}টি পণ্যের সরকারি দৈনিক বাজারদর, ইউনিট-সংশোধিত ও ধাপে ধাপে যাচাই করা। সর্বশেষ তারিখ: ${d.latestDate ?? "—"}.`;
  const canonical = `${ctx.origin.replace(/\/$/, "")}/`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "দরদেখা — বাংলাদেশের দৈনিক বাজারদর",
    description,
    url: canonical,
    creator: { "@type": "Organization", name: "দরদেখা" },
    isBasedOn: ctx.sourceName,
    license: `${ctx.origin.replace(/\/$/, "")}/licence`,
    dateModified: d.latestDate ?? undefined,
    temporalCoverage: "2025-06/ongoing",
    spatialCoverage: "Bangladesh",
    variableMeasured: ["retail price", "wholesale price", "district", "commodity"],
  };

  const chips = SAMPLE_QUERIES.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");

  const ledgerRows = d.ledger
    .map(
      (r, i) => `<tr class="ledger-reveal" style="animation-delay:${Math.min(i * 28, 420)}ms">
      <td class="c-item"><a href="${esc(r.url)}">${esc(r.commodityBn)}</a><span class="en">${esc(r.commodityEn)}</span></td>
      <td>${esc(r.districtBn)}</td>
      <td class="n">${esc(formatBdt(r.retail?.min))}–${esc(formatBdt(r.retail?.max))}</td>
      <td class="n">${esc(formatBdt(r.retail?.avg))}</td>
      <td class="n">${esc(formatBdt(r.wholesale?.avg))}</td>
      <td class="c-prov">${esc(r.date)} <span class="stamp ${r.carriedForward ? "carry" : "fresh"}">${r.carriedForward ? "পূর্বের" : "নতুন"}</span></td>
    </tr>`,
    )
    .join("\n");

  const moverCards = d.movers
    .map((m) => {
      const ch = m.changePct ?? 0;
      const cls = ch > 0.05 ? "up" : ch < -0.05 ? "dn" : "flat";
      const arrow = ch > 0.05 ? "▲" : ch < -0.05 ? "▼" : "—";
      return `<div class="mover">
        <div class="c">${esc(m.commodityBn)}</div>
        <div class="d">${esc(m.districtBn)}</div>
        <div class="v">
          <span class="now">${esc(formatBdt(m.now))}</span>
          <span class="was">${esc(formatBdt(m.was))}</span>
          <span class="ch ${cls}">${arrow} ${Math.abs(ch).toFixed(1)}%</span>
        </div>
      </div>`;
    })
    .join("\n");

  const figureRows = d.ledger.slice(0, 3).map((r) => ({
    name: r.commodityBn,
    place: r.districtBn,
    value: formatBdt(r.retail?.avg),
    fresh: !r.carriedForward,
  }));

  const body = `<section class="hero">
  <div class="shell">
    <div class="hero-grid">
      <div>
        <div class="eyebrow"><span class="dot"></span> কৃষি মন্ত্রণালয় · অনলাইন বাজারদর রিপোর্ট থেকে</div>
        <h1>আজকের <em>বাজারদর</em></h1>
        <p class="lead">বাংলাদেশের <b>${d.districtCount}টি জেলা</b> ও <b>${d.commoditiesWithData}টি পণ্যের</b> সরকারি খুচরা ও পাইকারি দর — প্রতিদিন, ইউনিট সংশোধিত, প্রতিটি সংখ্যার উৎস ও তারিখসহ।</p>
        <p class="stamp-note">সর্বশেষ সরকারি প্রতিবেদন: <strong>${esc(d.latestDate ?? "—")}</strong> · উৎস প্রতিদিন আগের দিনের হিসাব দেয়, তাই প্রতিটি উত্তরে তারিখ দেওয়া আছে।</p>

        <div class="lookup">
          <div class="lookup-label">আজ কত টাকা?</div>
          <form class="lookup-form" id="lookup" role="search" autocomplete="off">
            <input id="q" name="q" type="search" placeholder="পণ্য ও জেলা — যেমন: পেঁয়াজ ঢাকা" aria-label="পণ্য ও জেলা">
            <button type="submit">খুঁজুন</button>
          </form>
          <div class="lookup-answer" id="answer" aria-live="polite"></div>
        </div>

        <div class="chips">${chips}</div>
      </div>
      <div>
        ${ledgerFigure(figureRows)}
        <div class="figure-cap">আজকের খাতা · একটি পাতা</div>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="n">${d.districtCount}<small>টি</small></div><div class="l">জেলা</div></div>
      <div class="stat"><div class="n">${d.commoditiesWithData}<small>টি</small></div><div class="l">পণ্যে তথ্য (ক্যাটালগে ${d.commodityCount})</div></div>
      <div class="stat"><div class="n">${d.dayCount}<small> দিন</small></div><div class="l">আর্কাইভ</div></div>
      <div class="stat"><div class="n">${d.rowCount.toLocaleString("en-US")}</div><div class="l">তথ্যের সারি</div></div>
    </div>
  </div>
</section>

<section class="band">
  <div class="shell">
    <div class="sec-head"><span class="sec-kicker">আজকের খাতা</span><h2>সরকারি রিপোর্ট, লেখা হয়ে যাচ্ছে</h2></div>
    <p class="sec-note">নিচের প্রতিটি সারি একটি সরকারি রিপোর্ট থেকে নেওয়া। শেষ কলামে <span class="stamp fresh">নতুন</span> মানে আজ নতুন করে জমা দেওয়া হয়েছে, <span class="stamp carry">পূর্বের</span> মানে উৎস আগের দিনের সংখ্যাই সরিয়ে দিয়েছে।${
      d.carriedPct !== null
        ? ` এই প্রতিবেদনে <strong>${d.carriedPct}%</strong> সারি আগের দিনের মান — তাই দাম বদলেছে বলা যায় কেবল নতুন জমা দেওয়া সারি থেকে।`
        : ""
    }</p>
    <div class="sheet">
      <div class="sheet-bar"><span>আজকের খাতা · ${esc(d.ledgerDistrict)} জেলা</span><span>${esc(d.latestDate ?? "")}</span></div>
      <table class="ledger">
        <thead><tr><th scope="col">পণ্য</th><th scope="col">জেলা</th><th scope="col" class="n">খুচরা</th><th scope="col" class="n">মধ্যম</th><th scope="col" class="n">পাইকারি</th><th scope="col">অবস্থা</th></tr></thead>
        <tbody>${ledgerRows || '<tr><td colspan="6">এখনো কোনো তথ্য নেই।</td></tr>'}</tbody>
      </table>
      <a class="sheet-more" href="/price">ক্যাটালগের সব ${d.commodityCount}টি পণ্য ও প্রতিটি জেলার দর দেখুন →</a>
    </div>
  </div>
</section>

${
  d.movers.length
    ? `<section class="band">
  <div class="shell">
    <div class="sec-head"><span class="sec-kicker">পরিবর্তন</span><h2>এক দিনে যা বদলেছে</h2></div>
    <p class="sec-note">শুধু সেই সারিগুলো দেখানো হয়েছে যেখানে উৎস নতুন করে জমা দিয়েছে — অর্থাৎ আগের দিনের মান পুনরায় বসানো নয়।</p>
    <div class="movers">${moverCards}</div>
  </div>
</section>`
    : ""
}

<section class="band">
  <div class="shell">
    <div class="sec-head"><span class="sec-kicker">বিশ্বাসযোগ্যতা</span><h2>কেন এই সংখ্যা ভরসা করা যায়</h2></div>
    <p class="sec-note">সরকারি রিপোর্ট প্রকাশ করে ঠিক যেমন আছে — কিন্তু তিনটি জায়গায় সংশোধন দরকার হয়, না হলে সংখ্যা ভুল বোঝাবে।</p>
    <div class="pillars">
      <div class="pillar">
        <div class="num">০১</div>
        <h3>ইউনিট ঠিক করা</h3>
        <p>উৎস "কুইন্টাল" বলে <code>100 kg</code> ধরে সংখ্যা রাখে, অথচ প্রমাণিত কুইন্টাল 37.32 kg। ফলে চালের খুচরা দর ৮০ টাকা/কেজি হলে পাইকারি দর দেখাত ৭২৫০ — খুচরার উপরে, অসম্ভব। সঠিক স্কেলে ৭২.৫ টাকা/কেজি, খুচরার নিচে — বাস্তবসম্মত।</p>
      </div>
      <div class="pillar">
        <div class="num">০২</div>
        <h3>ফাঁকা থাকে ফাঁকা</h3>
        <p>কোনো তারিখে কোনো জেলা জমা দেয়নি, সেখানে কোনো সংখ্যা বানানো হয় না। আগের দিনের দর ধরে বসানো হয় না — কারণ সেটা মিথ্যা। যেখানে তথ্য নেই, সেখানে ফাঁকা।</p>
      </div>
      <div class="pillar">
        <div class="num">০৩</div>
        <h3>পুরোনো মান চিহ্নিত</h3>
        <p>উৎস প্রায়ই আগের দিনের সংখ্যা হুবহু সরিয়ে দেয়। সেই সারিগুলো আলাদা করে চিহ্নিত থাকে, যাতে পরিবর্তনের গ্রাফ কখনো মিথ্যা না দেখায়।</p>
      </div>
    </div>
  </div>
</section>

<section class="band">
  <div class="shell">
    <div class="sec-head"><span class="sec-kicker">যাচাই</span><h2>দাবি যাচাই করুন</h2></div>
    <p class="sec-note">কেউ বলছে "পেঁয়াজ ৬০ টাকা" — সত্য কি না দেখে নিন। সরকারি রেকর্ডের সাথে মিলিয়ে দেখানো হবে, সাথে উদ্ধৃতিযোগ্য লিংক।</p>
    <form class="lookup" method="get" action="/verify" style="margin:0">
      <div class="lookup-label">আপনার দাবি</div>
      <div class="lookup-form">
        <input name="claim" type="search" placeholder="যেমন: পেঁয়াজ ৬০ টাকা ঢাকায়" aria-label="যাচাই করার জন্য দাবি">
        <button type="submit">যাচাই করুন</button>
      </div>
    </form>
  </div>
</section>

<section class="band">
  <div class="shell">
    <div class="sec-head"><span class="sec-kicker">ডেভেলপার</span><h2>আপনার অ্যাপে নিয়ে যান</h2></div>
    <p class="sec-note">REST API, CSV এক্সপোর্ট আর MCP server — তিনভাবেই ডেটা নেওয়া যায়। প্রতিটি উত্তরে উৎস, তারিখ আর একটি উদ্ধৃতিযোগ্য URL থাকে, যাতে AI সহকারী উত্তরে লিংক দেখাতে পারে।</p>
    <pre><code><span class="c"># একটি জেলার আজকের সব দর</span>
GET /api/v1/latest?district=47

<span class="c"># একটি নির্দিষ্ট পণ্য ও জেলা</span>
GET /api/v1/price?commodity=পেঁয়াজ&amp;district=ঢাকা

<span class="c"># ইতিহাস, CSV</span>
GET /api/v1/series.csv?commodity=602&amp;district=47

<span class="c"># MCP server (stateless)</span>
POST /mcp   →   tools/call { name: "get_market_price", ... }</code></pre>
  </div>
</section>

<section class="band">
  <div class="shell">
    <div class="sec-head"><span class="sec-kicker">প্রক্রিয়া</span><h2>প্রতিদিন যেভাবে হয়</h2></div>
    <p class="sec-note">কোনো মানুষের হাত লাগে না — প্রতিটি ধাপ স্বয়ংক্রিয়।</p>
    <div class="steps">
      <div class="step"><div class="n">০১</div><h3>উৎস থেকে টানা হয়</h3><p>কৃষি মন্ত্রণালয়ের অনলাইন বাজারদর রিপোর্ট থেকে ৬৪ জেলার রিপোর্ট আসে।</p></div>
      <div class="step"><div class="n">০২</div><h3>ইউনিট ঠিক হয়</h3><p>পাইকারি দর প্রতি খুচরা-ইউনিটে রূপান্তরিত হয়, যাচাই করে।</p></div>
      <div class="step"><div class="n">০৩</div><h3>ফাঁকা চিহ্নিত হয়</h3><p>যেখানে উৎসে তথ্য নেই, সেখানে কোনো সংখ্যা থাকে না।</p></div>
      <div class="step"><div class="n">০৪</div><h3>প্রকাশ ও বিতরণ</h3><p>ওয়েবসাইট, টেলিগ্রাম চ্যানেল, API আর MCP-তে একসাথে প্রকাশিত হয়।</p></div>
      <div class="step"><div class="n">০৫</div><h3>যাচাই ও সংশোধন</h3><p>প্রতিটি সংখ্যা উদ্ধৃতিযোগ্য লিংকসহ থাকে, ভুল হলে ধরা পড়ে।</p></div>
    </div>
  </div>
</section>`;

  return layout({ title, description, canonical, body, ctx, jsonLd });
}

export function renderHomeMarkdown(d: HomeData, ctx: RenderContext): string {
  const lines = [
    "# দরদেখা — বাংলাদেশের দৈনিক বাজারদর",
    "",
    `সর্বশেষ প্রতিবেদন: ${d.latestDate ?? "—"}`,
    `উৎস: ${ctx.sourceName}`,
    "",
    `পরিসংখ্যান: ${d.districtCount} জেলা · ${d.commodityCount} পণ্য · ${d.dayCount} দিন · ${d.rowCount} সারি`,
    "",
    "## আজকের খাতা",
    "",
    "| পণ্য | জেলা | খুচরা | মধ্যম | পাইকারি | অবস্থা |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of d.ledger) {
    lines.push(
      `| ${r.commodityBn} | ${r.districtBn} | ${formatBdt(r.retail?.min)}–${formatBdt(r.retail?.max)} | ${formatBdt(r.retail?.avg)} | ${formatBdt(r.wholesale?.avg)} | ${r.date} ${r.carriedForward ? "(পূর্বের)" : "(নতুন)"} |`,
    );
  }
  lines.push("", `স্থায়ী লিংক: ${ctx.origin.replace(/\/$/, "")}/`, "");
  return lines.join("\n");
}

/* ──────────────────────────────────────────────────────────────────────────
   Per-fact page
   ────────────────────────────────────────────────────────────────────────── */

export interface PriceFact {
  commodityBn: string;
  commodityEn: string;
  districtBn: string;
  districtEn: string;
  date: string;
  retail: {
    min: number | null;
    max: number | null;
    avg: number | null;
    unitBn: string;
    unitEn: string;
    /** The source's figure is a mid-range estimate, not a mean over markets. */
    isMidpoint: boolean;
  };
  wholesale: {
    min: number | null;
    max: number | null;
    avg: number | null;
    unitBn: string;
    unitEn: string;
    isMidpoint: boolean;
  } | null;
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
    license: `${ctx.origin.replace(/\/$/, "")}/licence`,
    variableMeasured: ["retail price", "wholesale price"],
    measurementTechnique: "কৃষি মন্ত্রণালয় / DAM অনলাইন বাজারদর প্রতিদিনের রিপোর্ট",
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: `${canonical}.json`,
    },
  };

  const body = `<section class="band" style="border-bottom:0">
  <div class="shell">
    <div class="eyebrow"><span class="dot"></span> আজকের খাতা · একটি সারি</div>
    <h1 style="font-size:clamp(32px,5.4vw,52px)">${esc(f.commodityBn)} এর দর <em style="font-style:normal;color:var(--red)">${esc(f.districtBn)}</em></h1>
    <p class="lead"><b>${esc(f.commodityBn)}</b> এর ${esc(f.date)} তারিখে ${esc(f.districtBn)} জেলায় ${esc(sentence)}।</p>

    <div class="sheet" style="margin-top:26px">
      <div class="sheet-bar"><span>${esc(f.date)}</span><span>${esc(ctx.sourceName)}</span></div>
      <table class="ledger">
        <thead><tr><th scope="col">ধরন</th><th scope="col" class="n">ন্যূনতম</th><th scope="col" class="n">সর্বোচ্চ</th><th scope="col" class="n">মধ্যম</th><th scope="col">একক</th></tr></thead>
        <tbody>
          <tr><td class="c-item">খুচরা</td><td class="n">${esc(formatBdt(f.retail.min))}</td><td class="n">${esc(formatBdt(f.retail.max))}</td><td class="n">${esc(formatBdt(f.retail.avg))}</td><td class="c-prov">${esc(f.retail.unitBn)}</td></tr>
          ${
            f.wholesale
              ? `<tr><td class="c-item">পাইকারি</td><td class="n">${esc(formatBdt(f.wholesale.min))}</td><td class="n">${esc(formatBdt(f.wholesale.max))}</td><td class="n">${esc(formatBdt(f.wholesale.avg))}</td><td class="c-prov">${esc(f.wholesale.unitBn)}</td></tr>`
              : `<tr><td class="c-item">পাইকারি</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="c-prov">উৎসে নেই</td></tr>`
          }
        </tbody>
      </table>
      <div class="sheet-more">
        ${
          f.carriedForward
            ? `<span class="stamp carry">পূর্বের</span> উৎস এই দিনে আগের দিনের সংখ্যাই সরিয়ে দিয়েছে — নতুন করে কেউ জমা দেয়নি।`
            : `<span class="stamp fresh">নতুন</span> এই সংখ্যাগুলো উৎসে এই দিনে নতুন করে জমা দেওয়া হয়েছে।`
        }
        ${f.anomaly ? `<br><span class="stamp carry">সতর্কতা</span> ${esc(f.anomaly)}` : ""}
      </div>
    </div>

    <p style="margin-top:22px;font-size:15px">
      <a href="${esc(canonical)}.md">Markdown</a> ·
      <a href="${esc(canonical)}.json">JSON</a> ·
      <a href="/price">সব পণ্য</a> ·
      <a href="/verify">দাবি যাচাই করুন</a>
    </p>
  </div>
</section>`;

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
        // True when the source's figure is (min+max)/2 rather than a mean
        // over the markets that reported.
        is_midpoint: f.retail.isMidpoint,
      },
      wholesale: f.wholesale
        ? {
            min: f.wholesale.min,
            max: f.wholesale.max,
            avg: f.wholesale.avg,
            unit_bn: f.wholesale.unitBn,
            unit_en: f.wholesale.unitEn,
            is_midpoint: f.wholesale.isMidpoint,
          }
        : null,
    },
    carried_forward: f.carriedForward,
    anomaly: f.anomaly,
    source: {
      name: ctx.sourceName,
      // The human-facing government report, so a reader can follow the
      // citation to the actual document rather than to an API endpoint.
      url: "https://market.dam.gov.bd/market_daily_price_report",
      api: "https://moa-services.com/agri-service",
    },
    canonical_url: f.url,
    retrieved_at: ctx.generatedAt,
    licence: `${ctx.origin.replace(/\/$/, "")}/licence`,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   Commodity page
   ────────────────────────────────────────────────────────────────────────── */

export interface CommodityPageData {
  commodity: { id: number; bn: string; en: string; slug: string; groupBn: string };
  date: string | null;
  districtRows: (PriceRowOut & { districtNameBn: string; districtNameEn: string; districtSlug: string })[];
  history: { date: string; retailAvg: number | null; wholesaleAvg: number | null }[];
}

export function renderCommodityHtml(d: CommodityPageData, ctx: RenderContext): string {
  const title = `${d.commodity.bn} এর বাজারদর — সব জেলা, ${d.date ?? ""}`;
  const canonical = `${ctx.origin.replace(/\/$/, "")}/price/${d.commodity.slug}`;

  const withData = d.districtRows.filter((r) => r.retail?.avg != null);
  const avgRetail = withData.length
    ? withData.reduce((s, r) => s + (r.retail?.avg ?? 0), 0) / withData.length
    : null;
  const summary = withData.length
    ? `${d.commodity.bn} এর ${d.date ?? "—"} তারিখে জেলা-ভিত্তিক খুচরা দর জাতীয় গড় ${formatBdt(avgRetail)} টাকা; ${withData.length}টি জেলা থেকে তথ্য এসেছে।`
    : `${d.commodity.bn} এর জেলা-ভিত্তিক দর এখনো প্রকাশ করা হয়নি।`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${d.commodity.bn} — বাংলাদেশের দৈনিক বাজারদর`,
    description: summary,
    url: canonical,
    creator: { "@type": "Organization", name: "দরদেখা" },
    isBasedOn: ctx.sourceName,
    license: `${ctx.origin.replace(/\/$/, "")}/licence`,
    variableMeasured: ["retail price", "wholesale price", "district"],
    dateModified: d.date ?? undefined,
  };

  const rows = d.districtRows
    .map(
      (r) => `<tr>
      <td class="c-item"><a href="/price/${esc(d.commodity.slug)}/${esc(r.districtSlug)}">${esc(r.districtNameBn)}</a></td>
      <td class="n">${esc(formatBdt(r.retail?.min))}–${esc(formatBdt(r.retail?.max))}</td>
      <td class="n">${esc(formatBdt(r.retail?.avg))}</td>
      <td class="n">${esc(formatBdt(r.wholesale?.avg))}</td>
      <td class="c-prov">${esc(r.priceDate)} ${r.carriedForward ? '<span class="stamp carry">পূর্বের</span>' : '<span class="stamp fresh">নতুন</span>'}</td>
    </tr>`,
    )
    .join("\n");

  const body = `<section class="band" style="border-bottom:0">
  <div class="shell">
    <div class="eyebrow"><span class="dot"></span> ${esc(d.commodity.groupBn)} · আজকের খাতা</div>
    <h1 style="font-size:clamp(32px,5.4vw,52px)">${esc(d.commodity.bn)} এর বাজারদর</h1>
    <p class="lead">${esc(summary)}</p>

    <div class="sheet" style="margin-top:26px">
      <div class="sheet-bar"><span>জেলা অনুযায়ী · টাকা</span><span>${esc(d.date ?? "")}</span></div>
      <table class="ledger">
        <thead><tr><th scope="col">জেলা</th><th scope="col" class="n">খুচরা</th><th scope="col" class="n">মধ্যম</th><th scope="col" class="n">পাইকারি</th><th scope="col">অবস্থা</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">কোনো তথ্য নেই</td></tr>'}</tbody>
      </table>
    </div>

    ${renderTrendBlock(d)}
    <p style="margin-top:22px;font-size:15px"><a href="${esc(canonical)}.md">Markdown</a> · <a href="${esc(canonical)}.json">JSON</a> · <a href="/price">সব পণ্য</a></p>
  </div>
</section>`;

  return layout({ title, description: summary, canonical, body, ctx, jsonLd });
}

function renderTrendBlock(d: CommodityPageData): string {
  const pts = d.history.filter((h) => h.retailAvg !== null);
  if (pts.length < 2) return "";
  const first = pts[0]?.retailAvg ?? 0;
  const last = pts[pts.length - 1]?.retailAvg ?? 0;
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const dir = change > 0 ? "বেড়েছে" : change < 0 ? "কমেছে" : "পরিবর্তন হয়নি";
  return `<div class="sheet" style="margin-top:22px">
      <div class="sheet-bar"><span>শেষ ${pts.length} প্রতিবেদনের ধারা</span><span>${change > 0 ? "▲" : change < 0 ? "▼" : "—"} ${Math.abs(change).toFixed(1)}%</span></div>
      <table class="ledger">
        <thead><tr><th scope="col">তারিখ</th><th scope="col" class="n">খুচরা মধ্যম</th><th scope="col" class="n">পাইকারি মধ্যম</th></tr></thead>
        <tbody>${pts
          .slice()
          .reverse()
          .map(
            (p) =>
              `<tr><td class="c-item">${esc(p.date)}</td><td class="n">${esc(formatBdt(p.retailAvg))}</td><td class="n">${esc(formatBdt(p.wholesaleAvg))}</td></tr>`,
          )
          .join("\n")}</tbody>
      </table>
    </div>
    <p style="margin-top:14px;font-size:14.5px;color:var(--muted)">গত ${pts.length} প্রতিবেদনে জেলা-গড় খুচরা দর ${formatBdt(first)} থেকে ${formatBdt(last)} টাকা — ${esc(dir)} ${Math.abs(change).toFixed(1)}%।</p>`;
}

export function renderCommodityMarkdown(d: CommodityPageData, ctx: RenderContext): string {
  const lines = [
    `# ${d.commodity.bn} — বাংলাদেশের দৈনিক বাজারদর`,
    "",
    `তারিখ: ${d.date ?? "—"} · উৎস: ${ctx.sourceName}`,
    "",
    "## জেলা অনুযায়ী দর",
    "",
    "| জেলা | খুচরা ন্যূনতম | খুচরা সর্বোচ্চ | খুচরা মধ্যম | পাইকারি মধ্যম |",
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

export { toBanglaDigits, formatBdt };
