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

const folders = (await client.list()).map((f) => f.path ?? f.name);
console.log("folders:", folders.join(" | "));

for (const folder of ["[Gmail]/Sent Mail", "[Gmail]/Trash", "INBOX", "[Gmail]/All Mail"]) {
  if (!folders.includes(folder)) continue;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.mailboxOpen(folder);
    const uids = await client.search({ since: new Date(Date.now() - 3 * 86_400_000).toString("DD-Mon-YYYY") });
    console.log(`\n=== ${folder}: ${uids.length} recent ===`);
    for (const uid of uids.slice(-8)) {
      const m = await client.fetchOne(uid, { envelope: true }, { uid: true });
      const e = m?.envelope;
      console.log(`  uid=${uid} date=${e?.date} to=${e?.to?.[0]?.address} cc=${e?.cc?.[0]?.address ?? "-"}`);
      console.log(`     subject: ${e?.subject}`);
    }
    await client.mailboxClose();
  } finally {
    lock.release();
  }
}

await client.logout();
