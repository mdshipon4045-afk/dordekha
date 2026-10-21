/**
 * Which free domain suffixes can actually be used with a Cloudflare Worker?
 *
 * A Cloudflare Worker can only serve a custom hostname if that hostname is
 * a *zone* in the account, and Cloudflare only accepts a zone whose parent
 * is in the Public Suffix List. That single fact decides which free domain
 * services are usable and which are not.
 *
 *   node tools/check-free-domains.mjs
 */

import { readFileSync } from "node:fs";

const PSL_URL = "https://publicsuffix.org/list/public_suffix_list.dat";

/** The candidates worth checking, and why each one is on the list. */
const CANDIDATES = [
  { suffix: "eu.org", why: "EURid Foundation — free real subdomains, DNS and MX control" },
  { suffix: "pp.ua", why: "free .pp.ua for individuals" },
  { suffix: "us.kg", why: "free .us.kg domains" },
  { suffix: "js.org", why: "free for JavaScript projects" },
  { suffix: "is-a.dev", why: "free developer subdomains" },
  { suffix: "duckdns.org", why: "free dynamic DNS" },
  { suffix: "freedns.org", why: "afraid.org free subdomains" },
  { suffix: "mydns.digital", why: "afraid.org free subdomains" },
  { suffix: "workers.dev", why: "what we have now" },
  { suffix: "pages.dev", why: "Cloudflare Pages" },
  { suffix: "trycloudflare.com", why: "Cloudflare quick tunnels" },
  { suffix: "tk", why: "Freenom's old free TLDs" },
  { suffix: "ml", why: "Freenom's old free TLDs" },
  { suffix: "ga", why: "Freenom's old free TLDs" },
  { suffix: "cf", why: "Freenom's old free TLDs" },
  { suffix: "gq", why: "Freenom's old free TLDs" },
  { suffix: "nic.ua", why: "free .us domain with hosting" },
  { suffix: "za", why: "Free .za domains" },
  { suffix: "co.za", why: "Free .co.za domains" },
  { suffix: "vercel.app", why: "hosting subdomain" },
  { suffix: "netlify.app", why: "hosting subdomain" },
  { suffix: "web.app", why: "Firebase hosting" },
  { suffix: "blogspot.com", why: "Blogspot" },
  { suffix: "wixsite.com", why: "Wix" },
  { suffix: "r2.dev", why: "Cloudflare R2 public bucket" },
  { suffix: "onrender.com", why: "Render free tier" },
  { suffix: "fly.dev", why: "Fly.io" },
  { suffix: "glitch.me", why: "Glitch" },
  { suffix: "repl.co", why: "Replit" },
  { suffix: "github.io", why: "GitHub Pages" },
];

const psl = await (await fetch(PSL_URL)).text();
const rules = psl
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("//"))
  .map((l) => l.replace(/^!/, ""));

const isPublicSuffix = (name) => {
  // A rule matches itself and anything under it.
  return rules.some((r) => name === r || name.endsWith("." + r));
};

/** Can `brand.suffix` be a zone? It can if `suffix` is a public suffix. */
const canBeZone = (suffix) => isPublicSuffix(suffix);

console.log(`Public Suffix List: ${rules.length} rules\n`);
console.log("suffix".padEnd(24), "PSL", "  can be a Cloudflare zone?");
console.log("-".repeat(70));
for (const c of CANDIDATES) {
  const psl_ = isPublicSuffix(c.suffix);
  const zone = canBeZone(c.suffix);
  console.log(
    c.suffix.padEnd(24),
    psl_ ? "yes" : "no ",
    " ",
    zone ? "YES" : "no",
    "  ",
    c.why,
  );
}

/** The registrable domains we would actually want. */
console.log("\n--- the names we would want ---");
for (const name of ["dordekha.eu.org", "dordekha.pp.ua", "dordekha.js.org", "dordekha.is-a.dev"]) {
  const parts = name.split(".");
  const suffix = parts.slice(1).join(".");
  const registrable = isPublicSuffix(suffix);
  console.log(
    `${name.padEnd(22)} suffix=${suffix.padEnd(10)} parent-is-public-suffix=${registrable} → ${
      registrable ? "usable as a Cloudflare zone" : "NOT usable as a zone"
    }`,
  );
}
