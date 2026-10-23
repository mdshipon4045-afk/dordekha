/**
 * The WhatsApp door.
 *
 * Every blocked letter has a phone number on the same website. In this
 * market a shopkeeper answers WhatsApp faster than an inbox, and the owner
 * can send these with one tap. This writes two things:
 *
 *   docs/WHATSAPP-BN.md   the list, the message, and why each one
 *   docs/whatsapp.html    the same list as big buttons, so sending is a tap
 */
import { readFileSync, writeFileSync } from "node:fs";

const channels = JSON.parse(readFileSync(".private/contact-channels.json", "utf8"));
const byCompany = new Map(channels.map((c) => [c.company, c]));

const targets = [
  {
    company: "Fashol Dotcom Ltd.",
    phone: "8801810187230",
    note: "ইমেইল ঠিকানাটি অস্তিত্বহীন (550 User does not exist)",
    hook: "Jogaan-এ ওজন মাপার সময়ই কৃষকের দাম ঠিক করেন — সরকারি দৈনিক দাম-সিরিজ দিলে \"fair price\" প্রতিশ্রুতির প্রমাণ রাখা যায়",
  },
  {
    company: "Agrinofy",
    phone: "8801730081897",
    note: "ইমেইল Gmail-এর ফিল্টারে আটকে গেছে",
    hook: "Farmsfy মার্কেটপ্লেসে সবজি-মাছ-মাংসের দৈনিক দাম ও margin দেখাতে সরকারি সিরিজ কাজে লাগে",
  },
  {
    company: "InsureCow",
    phone: "8801999467873",
    note: "ইমেইল Gmail-এর ফিল্টারে আটকে গেছে",
    hook: "গবাদার বাজারদর ও দুধের ভ্যালু ইনডেক্স ছাড়া বীমার প্রিমিয়াম ও claim-এর মূল্যায়ন ঠিক হয় না",
  },
  {
    company: "WeGro",
    phone: "8801322891563",
    note: "CEO-র ঠিকানায় মেইল সার্ভার access denied দিয়েছে",
    hook: "\"Sure buyer and fair price\" প্রতিশ্রুতিতে বাজারের সরকারি দামের রেফারেন্স দরকার",
  },
  {
    company: "Creative Research (Creative Consulting)",
    phone: "8801948373084",
    note: "ইমেইল Gmail-এর ফিল্টারে আটকে গেছে",
    hook: "retail distributor audit ও FMCG price-tracking রিপোর্টে উদ্ধৃতিযোগ্য সরকারি দাম-সিরিজ দরকার",
  },
  {
    company: "nSearch Limited",
    phone: "8801334764200",
    note: "ইমেইল ব্লকড; ওয়েবসাইটের ফর্মটিও ভাঙা (নিজেদের SMTP error)",
    hook: "retail intelligence ও consumer price-tracking-এ ধারাবাহিক সরকারি দাম-সিরিজ দরকার",
  },
  {
    company: "Paikaro",
    phone: "8801314972357",
    note: "ইমেইলের ডোমেইনই মৃত (paikaro.com.bd NXDOMAIN) — ফোনই একমাত্র পথ",
    hook: "যেহেতু পুরো positioning-ই \"পাইকারি দামে সস্তা\", প্রতিদিনের সরকারি বাজারদর তাদের হিসাবের ভিত্তি হতে পারে",
  },
];

function message(t) {
  return [
    "আসসালামু আলাইকুম,",
    "",
    "আমি শৌরভ হাসান, দরদেখা চালাই (https://dordekha.pages.dev) — কৃষি মন্ত্রণালয়ের প্রতিদিনের বাজারদর রিপোর্ট থেকে ৬৪ জেলার খুচরা ও পাইকারি দাম, প্রতিটি সংখ্যার সাথে উৎস, তারিখ আর উদ্ধৃতিযোগ্য লিংক — API ও MCP আকারে।",
    "",
    `${t.hook}।`,
    "",
    "এক লাইনে দেখে নিতে পারেন:",
    'https://dordekha.pages.dev/api/v1/price?commodity=833&district=47',
    "",
    "চাইলে ১৫ মিনিটে একটি ফ্রি ডেমো key বানিয়ে দিতে পারি। ইমেইলে পাঠানোর চেষ্টা করেছিলাম, ফিরে এসেছে — তাই এখানে লিখলাম।",
    "",
    "ধন্যবাদ,",
    "শৌরভ হাসান — দরদেখা",
  ].join("\n");
}

const rows = targets.map((t) => {
  const text = message(t);
  const link = `https://wa.me/${t.phone}?text=${encodeURIComponent(text)}`;
  const c = byCompany.get(t.company);
  return { ...t, link, text, site: c ? `https://${c.domain}` : "" };
});

// The markdown list.
const md = [
  "# হোয়াটসঅ্যাপ — ব্লক হওয়া চিঠিগুলোর দ্বিতীয় দরজা",
  "",
  "যেসব কোম্পানির ইমেইল ফিরে এসেছে, তাদের প্রত্যেকের ওয়েবসাইটে ফোন নম্বর আছে।",
  "নিচের লিংকে ট্যাপ করলেই হোয়াটসঅ্যাপ খুলবে, বার্তা লেখা থাকবে — শুধু **Send** চাপতে হবে।",
  "",
  "| কোম্পানি | নম্বর | কেন ইমেইল যায়নি |",
  "|---|---|---|",
  ...rows.map((r) => `| ${r.company} | ${r.phone} | ${r.note} |`),
  "",
  "## বার্তা (প্রতিটির জন্য আলাদা, হুক বদলায়)",
  "",
  "```",
  rows[0].text,
  "```",
  "",
  "## পাঠানোর নিয়ম",
  "",
  "- দিনে **৫টির বেশি নয়**, একটি একটি করে, মাঝে কিছুক্ষণ বিরতি",
  "- কেউ \"পাঠাবেন না\" বললে সাথে সাথে থামুন, আর সেই নম্বরে আর লিখবেন না",
  "- কেউ আগ্রহ দেখালে সাথে সাথে বলুন: \"১৫ মিনিটে ডেমো key\" — আর আমাকে জানান",
  "",
  "## ট্যাপ করে পাঠানোর পাতা",
  "",
  "`docs/whatsapp.html` — ব্রাউজারে খুললেই বড় বড় বোতাম, এক ট্যাপে হোয়াটসঅ্যাপ।",
  "",
].join("\n");

writeFileSync("docs/WHATSAPP-BN.md", md, "utf8");

// The tap page: big buttons, one per company, phone-sized.
const html = `<!doctype html>
<html lang="bn">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>দরদেখা — হোয়াটসঅ্যাপ</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, "Noto Sans Bengali", sans-serif; margin: 0 auto; padding: 20px; max-width: 640px; background: #f7f6f2; color: #1d2b22; }
  h1 { font-size: 1.4rem; }
  p.lead { color: #55645a; }
  a.card { display: block; text-decoration: none; background: #fff; border: 1px solid #d8ded8; border-radius: 14px; padding: 14px 16px; margin: 10px 0; color: inherit; }
  a.card:active { background: #eef7ef; }
  .name { font-weight: 700; font-size: 1.05rem; }
  .num { font-variant-numeric: tabular-nums; color: #2f6b45; font-weight: 600; }
  .note { font-size: .85rem; color: #6b7a70; margin-top: 4px; }
  .go { float: left; background: #128c7e; color: #fff; border-radius: 999px; padding: 6px 14px; font-size: .85rem; margin-top: 8px; }
</style>
<h1>হোয়াটসঅ্যাপ — এক ট্যাপে চিঠি</h1>
<p class="lead">বাম দিকের নম্বরে ট্যাপ করলে হোয়াটসঅ্যাপ খুলবে, বার্তা আগে থেকেই লেখা। শুধু Send চাপুন। দিনে ৫টির বেশি নয়।</p>
${rows
  .map(
    (r) => `<a class="card" href="${r.link}" target="_blank" rel="noopener">
  <div class="name">${r.company}</div>
  <div class="num">+${r.phone}</div>
  <div class="note">${r.note}</div>
  <span class="go">হোয়াটসঅ্যাপে পাঠান</span>
</a>`,
  )
  .join("\n")}
</html>`;

writeFileSync("docs/whatsapp.html", html, "utf8");
console.log(`written: docs/WHATSAPP-BN.md (${rows.length} numbers)`);
console.log("written: docs/whatsapp.html");
for (const r of rows) console.log(`  ${r.company.padEnd(34)} +${r.phone}`);
