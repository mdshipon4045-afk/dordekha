// What does the site look like when the aggregates cache has expired and the
// database cannot be read? This is the state it is in right now.
const base = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";

const r = await fetch(`${base}/health`);
console.log(`health: ${r.status} ${await r.text()}`);

const home = await (await fetch(`${base}/`)).text();
const dates = [...new Set(home.match(/20\d\d-\d\d-\d\d/g) ?? [])];
console.log(`\nhome page dates: ${JSON.stringify(dates.slice(0, 8))}`);
console.log(`home says "সর্বশেষ প্রতিবেদন": ${/সর্বশেষ প্রতিবেদন/.test(home)}`);

const stats = [...home.matchAll(/<div class="n">([^<]*)(?:<small>([^<]*)<\/small>)?<\/div><div class="l">([^<]*)<\/div>/g)].map(
  (m) => `${m[1]}${m[2] ?? ""} ${m[3]}`,
);
console.log(`statistics strip: ${JSON.stringify(stats)}`);

const ds = await (await fetch(`${base}/dataset`)).text();
const cov = ds.match(/temporalCoverage[^,]*/);
console.log(`dataset temporalCoverage: ${cov ? cov[0] : "absent"}`);
console.log(`dataset shows ৬৪ জেলা: ${ds.includes("৬৪")}, shows "—" placeholders: ${(ds.match(/—/g) ?? []).length}`);

const api = await (await fetch(`${base}/api/v1/latest?district=47`)).json();
console.log(`api date: ${api.date}, rows: ${api.count}`);

const llms = await (await fetch(`${base}/llms.txt`)).text();
console.log(`llms.txt history line: ${(llms.match(/History currently held: [^\n]*/) ?? ["absent"])[0]}`);
