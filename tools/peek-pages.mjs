// Look at a few live responses directly, so the console's codepage does not
// hide what the site is actually saying.
const base = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";

async function show(path, pick) {
  const r = await fetch(base + path);
  const t = await r.text();
  console.log(`--- ${path} (${r.status}, ${t.length} bytes) ---`);
  console.log(pick ? pick(t) : t.slice(0, 300));
  console.log();
}

await show("/sitemap-facts-1.xml", (t) => t.slice(0, 400));
await show("/sitemap.xml", (t) => t.slice(0, 600));
await show("/methodology", (t) => {
  const i = t.indexOf("আগের দিনের মান");
  return i < 0 ? "phrase not found" : t.slice(Math.max(0, i - 120), i + 60);
});
await show("/methodology.md", (t) => {
  const i = t.indexOf("আগের দিনের মান");
  return i < 0 ? "phrase not found" : t.slice(Math.max(0, i - 120), i + 60);
});
