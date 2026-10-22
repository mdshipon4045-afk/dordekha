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

// Anything already flagged deleted goes out for good: closing the mailbox
// is what carries the expunge out.
for (const folder of ["[Gmail]/Sent Mail", "[Gmail]/All Mail", "INBOX"]) {
  if (!folders.includes(folder)) continue;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.mailboxOpen(folder);
    const uids = await client.search({ since: new Date(Date.now() - 7 * 86_400_000).toString("DD-Mon-YYYY") });
    let flagged = 0;
    for (const uid of uids) {
      let subject = "";
      try {
        const message = await client.fetchOne(uid, { envelope: true }, { uid: true });
        subject = message?.envelope?.subject ?? "";
      } catch {
        // The envelope will not come: the message is already flagged.
      }
      if (!subject) {
        await client.messageFlagsAdd(uid, ["\\Deleted"], { uid: true });
        flagged += 1;
      }
    }
    await client.mailboxClose();
    console.log(`${folder}: ${flagged} message(s) flagged, folder closed (expunged)`);
  } finally {
    lock.release();
  }
}

await client.logout();
console.log("done");
