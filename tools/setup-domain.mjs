/**
 * Attach a domain to the Worker, end to end.
 *
 *   node tools/setup-domain.mjs dordekha.eu.org <CLOUDFLARE_API_TOKEN>
 *
 * The owner has to do exactly one thing: create a Cloudflare API token with
 * "Zone:Edit" and "Account:Read" for their account, and paste it here.
 * Everything after that is this script: the zone, the nameservers for the
 * registry application, the Worker's custom domain, the canonical origin,
 * the deployment, and the check that the site really answers on the new
 * name.
 *
 * It is safe to run twice.
 */

import { readFileSync, writeFileSync } from "node:fs";

const CF = "https://api.cloudflare.com/client/v4";
const WORKER = "dordekha";
const ACCOUNT = "87013ff9a4f44a15adab832cc34f0c68";

const domain = process.argv[2];
const token = process.argv[3];

if (!domain || !token) {
  console.error("usage: node tools/setup-domain.mjs <domain> <CLOUDFLARE_API_TOKEN>");
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`${CF}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const messages = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${messages || body.messages?.join("; ")}`);
  }
  return body.result;
}

console.log(`=== ${domain} ===\n`);

/* 1. The zone. ------------------------------------------------------- */

let zone = null;
const found = await api(`/zones?name=${encodeURIComponent(domain)}&account.id=${ACCOUNT}`);
if (found.length > 0) {
  zone = found[0];
  console.log(`1. the zone already exists (${zone.id}, ${zone.status})`);
} else {
  zone = await api("/zones", {
    method: "POST",
    body: JSON.stringify({ name: domain, account: { id: ACCOUNT }, type: "full" }),
  });
  console.log(`1. zone created: ${zone.id} (${zone.status})`);
}

const nameservers = zone.name_servers ?? [];
console.log("   nameservers:");
for (const ns of nameservers) console.log(`     ${ns}`);

/* 2. The registry application. --------------------------------------- */

console.log("\n2. the registry application — give these nameservers to the registry:");
for (const ns of nameservers) console.log(`     ${ns}`);
console.log("   (eu.org, js.org, is-a.dev and pp.ua all accept the nameservers in this form)");

/* 3. The Worker's custom domain. ------------------------------------- */

let domainBinding = null;
const bindings = await api(`/accounts/${ACCOUNT}/workers/domains`);
domainBinding = bindings.find((b) => b.hostname === domain);
if (domainBinding) {
  console.log(`\n3. the Worker already serves ${domain}`);
} else {
  domainBinding = await api(`/accounts/${ACCOUNT}/workers/domains`, {
    method: "PUT",
    body: JSON.stringify({ hostname: domain, service: WORKER, zone_id: zone.id, environment: "production" }),
  });
  console.log(`\n3. the Worker now serves ${domain}`);
}

/* 4. The canonical origin. ------------------------------------------- */

const wranglerPath = "wrangler.jsonc";
const wrangler = readFileSync(wranglerPath, "utf8");
const next = wrangler.replace(
  /"SITE_ORIGIN":\s*"[^"]*"/,
  `"SITE_ORIGIN": "https://${domain}"`,
);
if (next !== wrangler) {
  writeFileSync(wranglerPath, next);
  console.log(`\n4. SITE_ORIGIN is now https://${domain}`);
} else {
  console.log(`\n4. SITE_ORIGIN already points somewhere — check wrangler.jsonc by hand`);
}

/* 5. Deploy. --------------------------------------------------------- */

console.log("\n5. deploying…");
const { execFileSync } = await import("node:child_process");
execFileSync("npx", ["wrangler", "deploy"], { stdio: "inherit" });

/* 6. Check. ---------------------------------------------------------- */

console.log("\n6. checking…");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
for (let attempt = 1; attempt <= 12; attempt++) {
  await wait(10_000);
  try {
    const res = await fetch(`https://${domain}/health`);
    const body = await res.json();
    const html = await (await fetch(`https://${domain}/`)).text();
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) ?? [])[1] ?? "";
    const citesUs = html.includes(domain);
    console.log(
      `   attempt ${attempt}: /health ${res.status} ${JSON.stringify(body)} · canonical ${canonical || "(none)"} · the page names the domain: ${citesUs}`,
    );
    if (res.ok && canonical.includes(domain)) {
      ok = true;
      break;
    }
  } catch (err) {
    console.log(`   attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(
  ok
    ? `\n${domain} is live and is the canonical origin.`
    : `\n${domain} is attached but the certificate or the DNS is not settled yet. It usually takes a few minutes; run this script again in half an hour.`,
);
console.log("\nStill to do by hand:\n  • the registry must delegate the nameservers above to us");
console.log("  • the site map, llms.txt and the MCP citation URLs now point at the new domain");
