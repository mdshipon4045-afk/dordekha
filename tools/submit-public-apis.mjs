/**
 * List the public API in public-apis/public-apis.
 *
 * The row goes into Food & Drink, alphabetically. Auth is "No": the public
 * tier answers without a key. HTTPS and CORS are both yes, checked live.
 */
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN missing");
  process.exit(1);
}
const UP = { owner: "public-apis", repo: "public-apis" };
const BRANCH = "add-dordekha";
const ROW =
  "| [Dordekha](https://dordekha.pages.dev) | Bangladesh's official daily agricultural market prices for 64 districts | No | Yes | Yes |";

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "dordekha-list-submission",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 260)}`);
  return body;
}

const who = await api("/user");
const ME = who.login;
console.log("acting as:", ME);

try {
  const fork = await api(`/repos/${UP.owner}/${UP.repo}/forks`, {
    method: "POST",
    body: JSON.stringify({ default_branch_only: true }),
  });
  console.log("fork requested:", fork.full_name);
} catch (err) {
  console.log("fork:", err.message.slice(0, 160));
}
let fork;
for (let i = 0; i < 20; i++) {
  try {
    fork = await api(`/repos/${ME}/${UP.repo}`);
    if (fork.default_branch) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("fork ready:", fork?.full_name, "| default:", fork?.default_branch);
const base = fork?.default_branch ?? "master";

const ref = await api(`/repos/${ME}/${UP.repo}/git/ref/heads/${base}`);
try {
  await api(`/repos/${ME}/${UP.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: ref.object.sha }),
  });
  console.log("branch created:", BRANCH);
} catch (err) {
  console.log("branch:", err.message.slice(0, 120));
}

const file = await api(`/repos/${ME}/${UP.repo}/contents/README.md?ref=${BRANCH}`);
const readme = Buffer.from(file.content, "base64").toString("utf8");
if (readme.includes("dordekha.pages.dev")) {
  console.log("already listed — nothing to do");
  process.exit(0);
}
// The alphabetical neighbours: after "Daily Food Recalls", before "DoughMatrix".
const anchor = "| [DoughMatrix](";
if (!readme.includes(anchor)) {
  console.error("the Food & Drink anchor moved — refusing to guess");
  process.exit(1);
}
const updated = readme.replace(anchor, `${ROW}\n${anchor}`);
const put = await api(`/repos/${ME}/${UP.repo}/contents/README.md`, {
  method: "PUT",
  body: JSON.stringify({
    message: "Add Dordekha (Bangladesh agricultural market prices)",
    content: Buffer.from(updated, "utf8").toString("base64"),
    sha: file.sha,
    branch: BRANCH,
  }),
});
console.log("committed:", put.commit?.sha?.slice(0, 10));

try {
  const pr = await api(`/repos/${UP.owner}/${UP.repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: "Add Dordekha — Bangladesh agricultural market prices",
      head: `${ME}:${BRANCH}`,
      base,
      body: [
        "Adds **Dordekha** to Food & Drink.",
        "",
        "Bangladesh's official daily agricultural market prices, published by the Ministry of Agriculture / DAM and republished as a free JSON API: 64 districts, retail and wholesale, unit-normalised, with source, date and a citable URL on every figure.",
        "",
        "- Docs: https://dordekha.pages.dev/api/v1",
        "- Auth: none on the public tier (2,000 calls/month)",
        "- HTTPS: yes",
        "- CORS: yes (`Access-Control-Allow-Origin: *`), verified live",
        "- Source: https://github.com/mdshipon4045-afk/dordekha",
      ].join("\n"),
    }),
  });
  console.log("PR opened:", pr.html_url);
} catch (err) {
  console.log("PR:", err.message.slice(0, 400));
}
