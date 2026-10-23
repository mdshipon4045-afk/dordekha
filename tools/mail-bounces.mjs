/**
 * Which of our letters actually bounced, and why.
 *
 * Gmail's bounce notice carries the answer in its machine-readable part:
 * "Final-Recipient: rfc822; someone@example.com" and "Diagnostic-Code".
 * Reading the raw source is the only reliable way to get both.
 */
import { readFileSync } from "node:fs";
import { ImapFlow } from "imapflow";

function credentials() {
  const raw = readFileSync(".secrets.env", "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return { user: out.MAIL_USER, password: out.MAIL_APP_PASSWORD };
}

const { user, password } = credentials();
const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user, pass: password },
  logger: false,
});
await client.connect();
const lock = await client.getMailboxLock("INBOX");
try {
  const uids = await client.search({ since: new Date(Date.now() - 4 * 86_400_000).toString("DD-Mon-YYYY") });
  const failed = [];
  for (const uid of uids) {
    const m = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
    const source = m?.source?.toString("utf8") ?? "";
    const subject = m?.envelope?.subject ?? "";
    if (!/delivery status|undelivered|failure|mail delivery/i.test(subject)) continue;
    const recipients = [...source.matchAll(/Final-Recipient:\s*rfc822;\s*([^\s;]+)/gi)].map((x) => x[1]);
    const codes = [...source.matchAll(/Diagnostic-Code:\s*([^\r\n]+)/gi)].map((x) => x[1].trim());
    const actions = [...source.matchAll(/Action:\s*(\w+)/gi)].map((x) => x[1]);
    // The original letter's recipient, when the notice carries it.
    const originalTo = [...source.matchAll(/^To:\s*(.+)$/gim)].map((x) => x[1].trim());
    const who = recipients.length ? recipients : originalTo;
    for (const r of who) {
      failed.push({ uid, to: r, action: actions[0] ?? "failed", code: codes[0] ?? "", subject });
    }
  }
  console.log(`bounce notices read: ${failed.length}`);
  const byAddress = new Map();
  for (const f of failed) {
    const prev = byAddress.get(f.to);
    if (!prev) byAddress.set(f.to, f);
  }
  for (const [to, f] of byAddress) {
    console.log(`\n${to}`);
    console.log(`   action: ${f.action}`);
    console.log(`   code: ${f.code.slice(0, 160)}`);
  }
} finally {
  await client.mailboxClose();
  await client.logout();
}
