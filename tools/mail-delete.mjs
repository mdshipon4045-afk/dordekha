/**
 * Delete a message from the owner's mailbox.
 *
 *   node tools/mail-delete.mjs "<subject fragment>"
 *
 * The message is flagged deleted and the folder is expunged, so it leaves
 * the sent folder and the all-mail view. It stays in the trash until the
 * trash is emptied, which is what a mailbox does with a deletion.
 *
 * The subject is matched in the script rather than in the search, because
 * the search does not match a subject in Bangla.
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

const fragment = process.argv[2];
if (!fragment) {
  console.error('usage: node tools/mail-delete.mjs "<subject fragment>"');
  process.exit(2);
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
let total = 0;

for (const folder of ["[Gmail]/Sent Mail", "[Gmail]/All Mail", "INBOX"]) {
  if (!folders.includes(folder)) continue;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.mailboxOpen(folder);
    const since = new Date(Date.now() - 3 * 86_400_000).toString("DD-Mon-YYYY");
    const uids = await client.search({ since });
    for (const uid of uids) {
      const message = await client.fetchOne(uid, { envelope: true }, { uid: true });
      const subject = message?.envelope?.subject ?? "";
      if (!subject.includes(fragment)) continue;
      console.log(`deleting from ${folder}: "${subject}" (uid ${uid})`);
      await client.messageFlagsAdd(uid, ["\\Deleted"], { uid: true });
      total += 1;
    }
    await client.mailboxClose();
  } finally {
    lock.release();
  }
}

await client.logout();
console.log(total === 0 ? "nothing matched" : `${total} message(s) deleted`);
