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

${p.does}। এখানে প্রতিদিনের সিদ্ধান্ত বাজারের দামের উপর দাঁড়ায় — অথচ সেই দাম এখন ফোনে ফোনে, পুরনো রিপোর্টে বা অনুমানে মেলাতে হয়।

দরদেখা থেকে আপনার কাজে যা আসবে:

  • ${p.why}
  • সকালে একবারেই ৬৪ জেলার সরকারি দাম হাতে — ফোনে ফোনে দর যাচাই করার দরকার নেই
  • কাউকে দাম দেখানোর সময় উৎস আর তারিখটাও সাথে দিতে পারবেন — দর কষাকষিতে আপনার কথাটা টেকে
  • পাইকারি "প্রতি ১০০ কেজি" আর খুচরা "প্রতি কেজি" — দুটোই এক ইউনিটে, হিসাব মেলাতে ভুল হয় না

যা লাগবে না: সাইন-আপ, কার্ড, চুক্তি — কিছুই না। ফ্রি সীমা মাসে ২,০০০ কল।

নিজে ৩০ সেকেন্ডে দেখুন:
  curl "https://dordekha.pages.dev/api/v1/price?commodity=833&district=47"

কাজে লাগবে বলে মনে হলে বলুন — ১৫ মিনিটে একটা ডেমো key বানিয়ে দেব, কোনো খরচ নেই।
কাজে না লাগলে এক লাইনে "না" বলুন, আর লিখব না।

বিনীত,
শৌরভ হাসান
দরদেখা — https://dordekha.pages.dev
`;
}

function subject(p) {
  return `${p.company}-এর প্রতিদিনের বাজারদর — উৎসসহ, এক কলে`;
}

// --preview=<email> prints exactly what would be sent, and sends nothing.
const preview = process.argv.find((a) => a.startsWith("--preview="))?.slice(10);
if (preview) {
  const p = prospects.find((x) => x.email === preview) ?? prospects[0];
  console.log(`to: ${p.email}\nsubject: ${subject(p)}\n\n${letter(p)}`);
  process.exit(0);
}

/**
 * How many letters a day, and how far apart.
 *
 * The first attempt sent eighteen in four minutes and the mailbox was
 * punished for it: letters bounced, one recipient's server refused the
 * message outright, and the sending account's reputation took the hit.
 * The fix is not three a day — at a four-in-a-hundred reply rate that is
 * a month for a handful of replies. It is volume with a warm-up and a
 * human pace: ten, then fifteen, then twenty a day, each letter minutes
 * apart, each written for its reader, and never twice to one company.
 */
const PER_DAY = 20;
const WARMUP = [10, 15, 20];
const GAP_MINUTES = [8, 18];

const log = [];
// A company gets one letter, even if two addresses on its domain are known.
// Shared mailbox providers are not companies: two Gmail prospects are two
// different readers, so their domain must not block the second letter.
const PUBLIC_MAILBOXES = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "zoho.com",
  "protonmail.com",
  "yandex.com",
]);
const isCompanyDomain = (domain) => Boolean(domain) && !PUBLIC_MAILBOXES.has(domain);
const history = (() => {
  try {
    return JSON.parse(readFileSync(".private/outreach-log.json", "utf8"));
  } catch {
    return [];
  }
})();
const today = new Date().toISOString().slice(0, 10);
const sentToday = history.filter((h) => h.sentAt && h.sentAt.slice(0, 10) === today).length;
const alreadySent = new Set(history.filter((h) => h.messageId).map((h) => h.email));
const sentDomains = new Set(
  history
    .filter((h) => h.messageId && h.email)
    .map((h) => h.email.split("@")[1]?.toLowerCase())
    .filter(isCompanyDomain),
);
// The first days are a warm-up: the mailbox earns volume, it does not claim it.
const priorDays = new Set(
  history
    .filter((h) => h.messageId && h.sentAt && h.sentAt.slice(0, 10) < today)
    .map((h) => h.sentAt.slice(0, 10)),
).size;
const allowance = WARMUP[Math.min(priorDays, WARMUP.length - 1)];
console.log(
  `today: ${sentToday} of ${allowance} letters already went out; ${alreadySent.size} addresses have had one`,
);
if (sentToday >= allowance) {
  console.log("the day's allowance is spent — the rest wait for tomorrow");
}

for (const p of prospects) {
  if (only && p.email !== only) continue;
  if (alreadySent.has(p.email)) {
    console.log(`skip ${p.email} — it already has a letter`);
    continue;
  }
  const domain = p.email.split("@")[1]?.toLowerCase();
  if (isCompanyDomain(domain) && sentDomains.has(domain)) {
    console.log(`skip ${p.email} — ${domain} already has a letter`);
    continue;
  }
  if (dry) {
    console.log(`--- would send to ${p.email} (${p.company})`);
    continue;
  }
  if (sentToday + log.filter((l) => l.messageId).length >= allowance) {
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
    if (isCompanyDomain(domain)) sentDomains.add(domain);
  } catch (err) {
    console.log(`FAILED ${p.email}: ${err instanceof Error ? err.message : String(err)}`);
    log.push({ ...p, error: String(err) });
  }
  // Write after every letter, not at the end: a run that is interrupted
  // must not forget who already received one.
  if (!dry) {
    const previous = history.filter((h) => h.messageId);
    writeFileSync(
      ".private/outreach-log.json",
      JSON.stringify([...previous, ...log], null, 1),
      "utf8",
    );
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
