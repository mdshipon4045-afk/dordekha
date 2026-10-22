/**
 * Publish the project to GitHub, and make a release for the MCP Registry.
 *
 *   node tools/publish-github.mjs [owner]
 *
 * The credential comes from Git Credential Manager, which is already set up on
 * this machine, so nothing has to be pasted anywhere. The repository is
 * created if it does not exist, the history is pushed, and a `v1.0.0` release
 * is published — the MCP Registry lists a server by its release, not by a
 * branch.
 *
 * The server manifest in `server.json` carries the public URL, so the site
 * has to be live before this runs.
 */

import { execFileSync } from "node:child_process";

const REPO = "dordekha";
const TAG = process.argv[3] ?? "v1.0.0";
const API = "https://api.github.com";

/** The credential for one GitHub account, from Git Credential Manager. */
function credential(user) {
  const input = `protocol=https\nhost=github.com\n${user ? `username=${user}\n` : ""}\n`;
  const out = execFileSync("git", ["credential", "fill"], { input, encoding: "utf8" });
  const password = /password=(.*)/.exec(out)?.[1]?.trim();
  const username = /username=(.*)/.exec(out)?.[1]?.trim();
  if (!password) throw new Error(`Git Credential Manager returned no token for ${user ?? "github.com"}`);
  return { username: username ?? "", password };
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${body.message ?? ""}`);
  return body;
}

/* 0. Whose account is the token for? The answer decides where the repository
   lives, and the manifest in server.json has to agree with it. */
const wanted = process.argv[2];
const { username, password } = credential(wanted);
const headers = {
  Authorization: `Bearer ${password}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "dordekha-publisher",
  "Content-Type": "application/json",
};
const me = await api("/user");
const OWNER = wanted ?? me.login;
console.log(`publishing as the GitHub account "${OWNER}"`);

/* 1. The repository. */
const existing = await api(`/repos/${OWNER}/${REPO}`).catch(() => null);
if (existing) {
  console.log(`the repository already exists: ${existing.html_url}`);
  if (existing.private) {
    await api(`/repos/${OWNER}/${REPO}`, { method: "PATCH", body: JSON.stringify({ private: false }) });
    console.log("  it was private — it is public now");
  }
} else {
  const created = await api("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: REPO,
      description:
        "দরদেখা — বাংলাদেশের সরকারি দৈনিক কৃষি বাজারদর, ইউনিট-সংশোধিত ও উদ্ধৃতিযোগ্য। Bangladesh's official daily agricultural market prices, unit-normalised and citable.",
      private: false,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    }),
  });
  console.log(`repository created: ${created.html_url} (public)`);
}

/* 2. The history. */
const remote = `https://github.com/${OWNER}/${REPO}.git`;
try {
  const current = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  if (current !== remote) execFileSync("git", ["remote", "set-url", "origin", remote]);
  else console.log("origin already points at the repository");
} catch {
  execFileSync("git", ["remote", "add", "origin", remote]);
  console.log("origin added");
}
execFileSync("git", ["-c", `credential.username=${OWNER}`, "push", "-u", "origin", "master"], {
  stdio: "inherit",
});
console.log("history pushed");

/* 3. The release — the registry reads the server from a release. */
const release = await api(`/repos/${OWNER}/${REPO}/releases`, {
  method: "POST",
  body: JSON.stringify({
    tag_name: TAG,
    name: `দরদেখা ${TAG}`,
    body: [
      "বাংলাদেশের কৃষি মন্ত্রণালয়ের কৃষি বিপণন অধিদপ্তর (DAM) প্রতিদিনের অনলাইন",
      "বাজারদর রিপোর্টের তথ্য — জেলা ভিত্তিক খুচরা ও পাইকারি দর — নিয়ে তৈরি একটি",
      "বাংলা ভাষার ওয়েবসাইট ও মেশিন-পড়যোগ্য API।",
      "",
      "- ওয়েবসাইট: https://dordekha.pages.dev",
      "- REST API: https://dordekha.pages.dev/api/v1/…",
      "- MCP server: https://dordekha.pages.dev/mcp",
      "- পদ্ধতি: https://dordekha.pages.dev/methodology",
      "- ডেটাসেট: https://dordekha.pages.dev/dataset",
      "",
      "প্রতিটি উত্তরে উৎস, তারিখ ও একটি উদ্ধৃতিযোগ্য লিংক থাকে।",
    ].join("\n"),
  }),
}).catch(async (err) => {
  // A release for a tag that already exists is not a failure.
  if (/already_exists/i.test(err.message)) {
    console.log(`the release ${TAG} already exists`);
    return null;
  }
  throw err;
});
if (release) console.log(`release published: ${release.html_url}`);
