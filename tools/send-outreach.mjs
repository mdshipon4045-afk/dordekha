/**
 * Send the outreach letters.
 *
 *   node tools/send-outreach.mjs .private/prospects.json
 *
 * The file holds one object per prospect:
 *   { company, domain, email, does, why }
 *
 * The letter is written for one reader: it opens with what that company
 * does, says what we have, and shows how to try it. It is short, it comes
 * from a person, and it says how to be left alone. A letter that reads like
 * a mail-merge is worse than no letter.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createTransport } from "nodemailer";

function credentials() {
  const raw = readFileSync(".secrets.env", "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return { user: out.MAIL_USER, password: out.MAIL_APP_PASSWORD };
}

const file = process.argv[2] ?? ".private/prospects.json";
const dry = process.argv.includes("--dry");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const prospects = JSON.parse(readFileSync(file, "utf8"));

const { user, password } = credentials();
const transport = createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass: password },
});

/** The letter, written for one reader. */
function letter(p) {
  const first = p.company.split(" ")[0];
  return `প্রিয় ${first} টিম,

আপনাদের ${p.does} — আমি ভাবছি একটা বিষয়ে বলব, কারণ আপনারা বাজারের সংখ্যা
নিয়ে কাজ করেন।

আমি দরদেখা চালাই (https://dordekha.pages.dev) — এটি কৃষি মন্ত্রণালয়ের প্রতিদিনের বাজারদর
রিপোর্ট থেকে তৈরি একটি ছোট সেবা: ৬৪ জেলা, খুচরা ও পাইকারি, প্রতিটি সংখ্যার সাথে
উৎস, তারিখ আর উদ্ধৃতিযোগ্য লিংক। পাইকারি দর "প্রতি ১০০ কেজি" হলে তা খুচরার একই ইউনিটে
এসে যায়, আর কোন গুণক ব্যবহার হয়েছে তা প্রতিটি সারিতে লেখা থাকে।

${p.why}

এক লাইনে দেখে নিতে পারেন:
  curl "https://dordekha.pages.dev/api/v1/price?commodity=833&district=47"

আর AI চ্যাটবটে বসাতে:
  { "mcpServers": { "dordekha": { "url": "https://dordekha.pages.dev/mcp" } } }

ফ্রি: পাবলিক সাইট, MCP server, মাসে ২,০০০ কল পর্যন্ত API — কোনো সাইন-আপ নয়।
বাণিজ্যিক: ৳২,০০০/মাস থেকে।

কোনো কিছু না চাইলে এক লাইনে জানিয়ে দিন, আর আর লিখব না।
চাইলে আমি ১৫ মিনিটে একটি ডেমো key বানিয়ে দিতে পারি।

বিনীত,
শৌরভ হাসান
দরদেখা — https://dordekha.pages.dev
`;
}

function subject(p) {
  return `সরকারি দৈনিক বাজারদর — API ও AI-তে (${p.company})`;
}

/**
 * How many letters a day, and how far apart.
 *
 * The first attempt sent eighteen in four minutes and the mailbox was
 * punished for it: letters bounced, one recipient's server refused the
 * message outright, and the sending account's reputation took the hit.
 * A cold letter is worth more when it arrives alone. Three a day, each
 * with a gap of minutes between them, and never twice to the same
 * address.
 */
const PER_DAY = 3;
const GAP_MINUTES = [4, 9];

const log = [];
const history = (() => {
  try {
    return JSON.parse(readFileSync(".private/outreach-log.json", "utf8"));
  } catch {
    return [];
  }
})();
const sentToday = history.filter(
  (h) => h.sentAt && h.sentAt.slice(0, 10) === new Date().toISOString().slice(0, 10),
).length;
const alreadySent = new Set(history.filter((h) => h.messageId).map((h) => h.email));
console.log(
  `today: ${sentToday} of ${PER_DAY} letters already went out; ${alreadySent.size} addresses have had one`,
);
if (sentToday >= PER_DAY) {
  console.log("the day's allowance is spent — the rest wait for tomorrow");
}

for (const p of prospects) {
  if (only && p.email !== only) continue;
  if (alreadySent.has(p.email)) {
    console.log(`skip ${p.email} — it already has a letter`);
    continue;
  }
  if (dry) {
    console.log(`--- would send to ${p.email} (${p.company})`);
    continue;
  }
  if (sentToday + log.filter((l) => l.messageId).length >= PER_DAY) {
    console.log(`stopping for today — the rest wait for tomorrow`);
    break;
  }
  try {
    const info = await transport.sendMail({
      from: `"শৌরভ হাসান (দরদেখা)" <${user}>`,
      to: p.email,
      subject: subject(p),
      text: letter(p),
      headers: { "X-Mailer": "dordekha-outreach" },
    });
    console.log(`sent: ${p.email} — ${p.company} — ${info.messageId}`);
    log.push({ ...p, sentAt: new Date().toISOString(), messageId: info.messageId });
  } catch (err) {
    console.log(`FAILED ${p.email}: ${err instanceof Error ? err.message : String(err)}`);
    log.push({ ...p, error: String(err) });
  }
  // A pause between letters: minutes, not seconds, and not the same
  // every time.
  const gap = GAP_MINUTES[0] + Math.random() * (GAP_MINUTES[1] - GAP_MINUTES[0]);
  await new Promise((r) => setTimeout(r, gap * 60_000));
}

if (!dry) {
  const previous = history.filter((h) => h.messageId);
  writeFileSync(
    ".private/outreach-log.json",
    JSON.stringify([...previous, ...log], null, 1),
    "utf8",
  );
}
transport.close();
console.log(`\n${log.filter((l) => l.messageId).length} sent of ${log.length}`);
