/**
 * List the MCP server in punkpeye/awesome-remote-mcp-servers.
 *
 * The list only takes remote servers, and CI checks that the endpoint
 * answers an MCP initialize and that a Glama connector badge resolves.
 * The fork, the branch and the pull request are made through the API so
 * the step is repeatable when the entry needs a fix.
 */
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN missing");
  process.exit(1);
}
const UP = { owner: "punkpeye", repo: "awesome-remote-mcp-servers" };
const BRANCH = "add-dordekha";

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
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const ENTRY = [
  "- [Dordekha](https://dordekha.pages.dev) `https://dordekha.pages.dev/mcp`",
  `  [![Dordekha MCP connector](https://glama.ai/mcp/connectors/io.github.mdshipon4045-afk/dordekha/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.mdshipon4045-afk/dordekha)`,
  "  🔓 - Official Bangladesh crop prices: 64 districts, retail and wholesale, source and date on every figure.",
].join("\n");

// 0. Whose token is this? The credential store can hold more than one
// account, and the fork must be made by the account that owns the token.
const who = await api("/user");
const ME = who.login;
console.log("acting as:", ME);

// 1. The fork.
let fork;
try {
  fork = await api(`/repos/${UP.owner}/${UP.repo}/forks`, {
    method: "POST",
    body: JSON.stringify({ default_branch_only: true }),
  });
  console.log("fork requested:", fork.full_name);
} catch (err) {
  console.log("fork request:", err.message.slice(0, 200));
}
for (let i = 0; i < 20; i++) {
  try {
    fork = await api(`/repos/${ME}/${UP.repo}`);
    if (fork.default_branch) break;
  } catch {
    /* not there yet */
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("fork ready:", fork?.full_name, "| default branch:", fork?.default_branch);
const base = fork?.default_branch ?? "main";

// 2. The branch, from the tip of the fork's default branch.
const ref = await api(`/repos/${ME}/${UP.repo}/git/ref/heads/${base}`);
const sha = ref.object.sha;
try {
  await api(`/repos/${ME}/${UP.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha }),
  });
  console.log("branch created:", BRANCH);
} catch (err) {
  console.log("branch:", err.message.slice(0, 140));
}

// 3. The README, with the entry placed in the Agriculture section.
const file = await api(`/repos/${ME}/${UP.repo}/contents/README.md?ref=${BRANCH}`);
const readme = Buffer.from(file.content, "base64").toString("utf8");
if (readme.includes("dordekha.pages.dev")) {
  console.log("already listed — nothing to do");
  process.exit(0);
}
const anchor = "- [upCampo]";
if (!readme.includes(anchor)) {
  console.error("the Agriculture anchor moved — refusing to guess");
  process.exit(1);
}
const updated = readme.replace(anchor, `${ENTRY}\n${anchor}`);
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

// 4. The pull request.
try {
  const pr = await api(`/repos/${UP.owner}/${UP.repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: "Add Dordekha — Bangladesh agricultural market prices (MCP)",
      head: `${ME}:${BRANCH}`,
      base,
      body: [
        "Adds a remote MCP server under **Agriculture**.",
        "",
        "- Endpoint: `https://dordekha.pages.dev/mcp`",
        "- Source: https://github.com/mdshipon4045-afk/dordekha",
        "- Glama connector: https://glama.ai/mcp/connectors/io.github.mdshipon4045-afk/dordekha",
        "- Registry: `io.github.mdshipon4045-afk/dordekha`",
        "",
        "The server publishes Bangladesh's official daily agricultural market prices (Ministry of Agriculture / DAM report), unit-normalised, with source, date and a citable URL on every figure. Free to read; no key needed for the public tier.",
        "",
        "Tools: `search_commodities`, `list_districts`, `get_prices`, `price_history`, `verify_claim`, `get_methodology`.",
      ].join("\n"),
    }),
  });
  console.log("PR opened:", pr.html_url);
} catch (err) {
  console.log("PR:", err.message.slice(0, 400));
}
