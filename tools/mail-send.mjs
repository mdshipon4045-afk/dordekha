/**
 * Send from the owner's mailbox.
 *
 * The app password in `.secrets.env` gives both IMAP (read) and SMTP (send)
 * on that account. This is how the licence letter to DAM/ডিসিম goes out,
 * and how a reply to a prospect goes out — from the address the domain will
 * later carry, so the first contact is already on our own domain.
 *
 *   node tools/mail-send.mjs verify
 *   node tools/mail-send.mjs send <to> <subject> <file-with-the-body> [attachment]
 *
 * Nothing is sent without an explicit `send`, and the body is read from a
 * file so that what is sent is exactly what was reviewed.
 */

import { readFileSync } from "node:fs";
import { createTransport } from "nodemailer";

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

const [, , command = "verify", ...rest] = process.argv;
const { user, password } = credentials();

const transport = createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass: password },
});

if (command === "verify") {
  try {
    await transport.verify();
    console.log(`SMTP verified. Sending from ${user} is possible.`);
  } catch (err) {
    console.log(`SMTP failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
} else if (command === "send") {
  const [to, subject, bodyFile, attachment] = rest;
  if (!to || !subject || !bodyFile) {
    console.log("usage: node tools/mail-send.mjs send <to> <subject> <body-file> [attachment]");
    process.exitCode = 2;
  } else {
    const body = readFileSync(bodyFile, "utf8");
    const message = {
      from: `"দরদেখা (Dordekha)" <${user}>`,
      to,
      subject,
      text: body,
    };
    if (attachment) {
      message.attachments = [{ filename: attachment.split(/[\\/]/).pop(), path: attachment }];
    }
    const info = await transport.sendMail(message);
    console.log(`sent: ${info.messageId} → ${to}`);
  }
} else {
  console.log("usage: node tools/mail-send.mjs verify | send <to> <subject> <body-file> [attachment]");
}

transport.close();
