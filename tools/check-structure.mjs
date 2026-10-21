// Check the structure of the rebuilt content pages, so a design regression
// shows up as a missing class rather than as a feeling.
const base = process.env.BASE ?? "https://dordekha.pages.dev";

const pages = ["/", "/dataset", "/methodology", "/licence", "/api", "/price", "/verify"];
let bad = 0;

for (const p of pages) {
  const r = await fetch(base + p);
  const t = await r.text();
  const markers = {
    "band wrapper": t.includes('class="band"'),
    "shell": t.includes('class="shell"'),
    "masthead": t.includes('class="masthead"'),
    "footer": t.includes("<footer>"),
    "eyebrow": t.includes('class="eyebrow"'),
    h1: /<h1[^>]*>/.test(t),
    "brand mark": t.includes("brand-mark"),
    "skip link": t.includes('class="skip"'),
    "lang=bn": t.includes('lang="bn"'),
  };
  const missing = Object.entries(markers).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) bad++;
  console.log(`${r.status === 200 ? "OK  " : "FAIL"} ${p.padEnd(12)} ${t.length} bytes  ${missing.length ? "missing: " + missing.join(", ") : "all markers present"}`);
}

// The content pages must also carry their actual content.
const checks = [
  ["/dataset", ["পরিসংখ্যান", "ক্যাটালগে", "উপজেলা", "পূর্বের মান"]],
  ["/methodology", ["ইউনিট কোড", "মধ্যম-পরিমাণ", "ফাঁকা (গ্যাপ) সৎভাব", "ইউনিট সংশোধন"]],
  ["/licence", ["ব্যক্তিগল ও গবেষণা", "বাণিজ্যিক ব্যবহার", "দায়বশীমতা"]],
  ["/api", ["/api/v1/units", "get_market_price", "text/markdown"]],
];
for (const [p, phrases] of checks) {
  const t = await (await fetch(base + p)).text();
  const missing = phrases.filter((x) => !t.includes(x));
  if (missing.length) bad++;
  console.log(`${missing.length ? "FAIL" : "OK  "} ${p.padEnd(12)} content: ${missing.length ? "missing " + JSON.stringify(missing) : "all phrases present"}`);
}

console.log(bad === 0 ? "\nstructure OK" : `\n${bad} structural problems`);
