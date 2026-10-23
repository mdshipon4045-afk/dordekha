/**
 * The other door: a company's own contact form.
 *
 *   node tools/contact-form.mjs .private/form-messages.json [--dry]
 *
 * Some inboxes refuse mail from a young Gmail account, but the form on the
 * company's own site goes straight to their own script. The message is the
 * same letter, shortened for a textarea, and it says plainly why it comes
 * through the form instead of email.
 */
import { readFileSync, appendFileSync } from "node:fs";

const file = process.argv[2] ?? ".private/form-messages.json";
const dry = process.argv.includes("--dry");
const messages = JSON.parse(readFileSync(file, "utf8"));

for (const m of messages) {
  const body = new URLSearchParams(m.fields);
  console.log(`\n${m.company}  ->  ${m.url}`);
  console.log(`   fields: ${Object.keys(m.fields).join(", ")}`);
  if (dry) {
    console.log("   (dry) not sent");
    continue;
  }
  try {
    const res = await fetch(m.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        Referer: m.referer ?? m.url,
        Accept: "text/html,application/xhtml+xml",
      },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    const note = /thank|success|sent|ধন্যবাদ|পাঠানো/i.test(text) ? "looks accepted" : "check the answer";
    console.log(`   HTTP ${res.status} — ${note} — ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140)}`);
    appendFileSync(
      ".private/form-log.txt",
      `${new Date().toISOString()} | ${m.company} | ${m.url} | HTTP ${res.status} | ${note}\n`,
      "utf8",
    );
  } catch (err) {
    console.log(`   FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}
