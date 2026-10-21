/**
 * The owner's mailbox, over IMAP.
 *
 * Why: eu.org, js.org, DigitalPlat and every other domain registry confirm
 * by email, and the owner's Gmail is where those land. The app password is
 * in `.secrets.env`, which is git-ignored and never committed.
 *
 *   node tools/mail.mjs inbox            # the last messages
 *   node tools/mail.mjs find eu.org      # messages matching a phrase
 *   node tools/mail.mjs read <id>        # one message, in full
 *
 * The password is never printed. The script prints subjects and senders.
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
  if (!out.MAIL_USER || !out.MAIL_APP_PASSWORD) {
    throw new Error("MAIL_USER / MAIL_APP_PASSWORD are not set in .secrets.env");
  }
  return { user: out.MAIL_USER, password: out.MAIL_APP_PASSWORD };
}

export async function connect() {
  const { user, password } = credentials();
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();
  return client;
}

/** A short, readable summary of a message. */
function summarise(message) {
  const from = message.from?.value?.[0];
  return {
    id: message.id,
    date: message.date?.toISOString?.() ?? String(message.date ?? ""),
    from: from ? `${from.name ?? ""} <${from.address}>` : "?",
    subject: message.subject ?? "(no subject)",
    seen: message.seen,
  };
}

/** The messages in a folder, newest first. */
export async function listMessages(client, folder = "INBOX", limit = 25) {
  const lock = await client.getMailboxLock(folder);
  try {
    const { count } = await client.status(folder, { messages: true });
    if (!count) return [];
    const from = Math.max(1, count - limit + 1);
    const messages = await client.fetch(`${from}:${count}`, { envelope: true, flags: true }, {});
    return messages.map((m) => summarise(m)).reverse();
  } finally {
    lock.release();
  }
}

/** The body of one message, as text. */
export async function readMessage(client, id) {
  const lock = await client.getMailboxLock("INBOX");
  try {
    const message = await client.fetchOne(String(id), { envelope: true, source: true }, { uid: false });
    if (!message) return null;
    return { ...summarise(message), body: message.source?.toString() ?? "" };
  } finally {
    lock.release();
  }
}

/** Every folder that might hold a confirmation. */
export async function folders(client) {
  const list = await client.list();
  return list.filter((f) => f.attributes?.includes("\\HasNoChildren") === false).map((f) => f.path);
}

const [, , command = "inbox", argument] = process.argv;

const client = await connect();
try {
  if (command === "inbox") {
    const messages = await listMessages(client, "INBOX", Number(argument ?? 25));
    for (const m of messages) {
      console.log(`${m.date}  ${m.seen ? " " : "●"} ${m.from}`);
      console.log(`   ${m.subject}`);
    }
    console.log(`\n(${messages.length} messages)`);
  } else if (command === "folders") {
    for (const f of await folders(client)) console.log(f);
  } else if (command === "find") {
    const needle = (argument ?? "").toLowerCase();
    for (const box of ["INBOX", "[Gmail]/Spam", "[Gmail]/All Mail"]) {
      let messages = [];
      try {
        messages = await listMessages(client, box, 200);
      } catch {
        continue;
      }
      const hits = messages.filter((m) => `${m.subject} ${m.from}`.toLowerCase().includes(needle));
      if (hits.length) console.log(`--- ${box} (${hits.length}) ---`);
      for (const m of hits) console.log(`  ${m.date}  ${m.from}\n    ${m.subject}`);
    }
  } else if (command === "read") {
    const message = await readMessage(client, argument ?? "");
    if (!message) {
      console.log("no such message");
    } else {
      console.log(`${message.date}  ${message.from}`);
      console.log(`Subject: ${message.subject}`);
      console.log("---");
      console.log(message.body.slice(0, 4000));
    }
  } else {
    console.log("usage: node tools/mail.mjs inbox | folders | find <phrase> | read <id>");
  }
} finally {
  await client.logout();
}
