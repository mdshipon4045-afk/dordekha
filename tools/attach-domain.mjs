/**
 * Point a domain at the worker.
 *
 *   node tools/attach-domain.mjs dordekha.dpdns.org
 *
 * Two ways to do it, and the script takes whichever the token allows:
 *
 *   1. the custom domain of the worker  — the tidy way, and the one the
 *      cloudflare dashboard offers. It needs an account scoped token.
 *   2. a proxied CNAME record that points at the worker's own address
 *      — the way that works with a zone scoped token, which is what most
 *      people have. The edge resolves the name and hands the request to
 *      the worker, and the certificate for the zone is issued for it.
 *
 * Either way the site ends up on the new name, and the check at the end
 * says so. Running it twice is safe.
 */

import { readFileSync } from "node:fs";

const CF = "https://api.cloudflare.com/client/v4";
const WORKER = "dordekha";
const ACCOUNT = "87013ff9a4f44a15adab832cc34f0c68";

const domain = process.argv[2];
if (!domain) {
  console.error("usage: node tools/attach-domain.mjs <domain>");
  process.exit(2);
}

const token = readToken();
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

function readToken() {
  try {
    const raw = readFileSync(".secrets.env", "utf8");
    const m = raw.match(/^CLOUDFLARE_API_TOKEN=(.*)$/m);
    if (m) return m[1].trim();
  } catch {
    /* no secrets file */
  }
  console.error("no Cloudflare API token in .secrets.env");
  process.exit(2);
}

async function api(path, init = {}) {
  const res = await fetch(`${CF}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const messages = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
    const err = new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${messages || body.message || ""}`);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

console.log(`=== ${domain} ===\n`);

/* 1. the zone --------------------------------------------------------- */

const found = await api(`/zones?name=${encodeURIComponent(domain)}&account.id=${ACCOUNT}`);
if (found.length === 0) {
  console.error(`no zone named ${domain} in this account`);
  process.exit(1);
}
const zone = found[0];
console.log(`1. the zone: ${zone.id} (${zone.status})`);

if (zone.status !== "active") {
  console.log("   the registry has not delegated yet, so nothing can be served.");
  console.log(`   put these nameservers in the registry panel:`);
  for (const ns of zone.name_servers ?? []) console.log(`     ${ns}`);
  process.exit(0);
}

/* 2. the address the worker answers on --------------------------------- */

/* The worker's own address. The script api may be closed to the token, so
   the subdomain of the account is asked for instead, and a known address is
   the last resort. */
let workersDev = null;
try {
  const script = await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}`);
  workersDev = script.default_environment?.script?.url ?? script.default_environment?.url ?? null;
} catch {
  /* the token cannot read the script */
}
if (!workersDev) {
  try {
    const sub = await api(`/accounts/${ACCOUNT}/workers/subdomain`);
    if (sub?.subdomain) workersDev = `https://${WORKER}.${sub.subdomain}.workers.dev`;
  } catch {
    /* the token cannot read the subdomain either */
  }
}
if (!workersDev) workersDev = `https://${WORKER}.shouroveh9.workers.dev`;
console.log(`2. the worker: ${workersDev}`);

/* 3. the custom domain, if the token allows it ------------------------- */

let how = "";
try {
  const bindings = await api(`/accounts/${ACCOUNT}/workers/domains`);
  if (bindings.some((b) => b.hostname === domain)) {
    console.log(`3. the worker already serves ${domain}`);
    how = "custom domain";
  } else {
    await api(`/accounts/${ACCOUNT}/workers/domains`, {
      method: "PUT",
      body: JSON.stringify({ hostname: domain, service: WORKER, zone_id: zone.id }),
    });
    console.log(`3. the worker now serves ${domain} (custom domain)`);
    how = "custom domain";
  }
} catch (err) {
  console.log(`3. the custom domain api is not open to this token (${err.message})`);
  console.log("   falling back to a proxied CNAME record");
  how = "cname";
}

/* 4. the CNAME, when that is the way ----------------------------------- */

if (how === "cname") {
  if (!workersDev) {
    console.error("   the worker's own address is unknown, so there is nothing to point at");
    process.exit(1);
  }
  const target = workersDev.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const existing = await api(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}`);
  const mine = existing.find((r) => r.type === "CNAME" && r.content === target);
  if (mine) {
    console.log(`4. the CNAME is already there: ${domain} -> ${target}`);
  } else {
    for (const stale of existing) {
      if (stale.type === "CNAME" || stale.type === "A" || stale.type === "AAAA") {
        await api(`/zones/${zone.id}/dns_records/${stale.id}`, { method: "DELETE" });
        console.log(`   removed the old ${stale.type} record`);
      }
    }
    await api(`/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: domain,
        content: target,
        proxied: true,
        ttl: 1,
      }),
    });
    console.log(`4. the CNAME is there now: ${domain} -> ${target}`);
  }
}

/* 5. mail for the domain ----------------------------------------------- */

try {
  const settings = await api(`/zones/${zone.id}/email/routing`);
  if (settings?.enabled) {
    console.log(`5. email routing is on: ${domain} can receive mail`);
  } else {
    console.log("5. email routing is off — the domain has no mailbox yet");
  }
} catch {
  console.log("5. email routing is not visible to this token");
}

/* 6. the check --------------------------------------------------------- */

console.log("\n6. waiting for the name to answer…");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
for (let attempt = 1; attempt <= 15; attempt++) {
  await wait(10_000);
  try {
    const res = await fetch(`https://${domain}/health`);
    const body = await res.json();
    const home = await (await fetch(`https://${domain}/`)).text();
    const canonical = (home.match(/<link rel="canonical" href="([^"]+)"/) ?? [])[1] ?? "";
    console.log(
      `   attempt ${attempt}: /health ${res.status} ${JSON.stringify(body)} · canonical ${canonical || "(none)"}`,
    );
    if (res.ok) {
      ok = true;
      break;
    }
  } catch (err) {
    console.log(`   attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(
  ok
    ? `\n${domain} answers.`
    : `\n${domain} is attached but has not answered yet. Certificates take a few minutes; run this again in half an hour.`,
);
