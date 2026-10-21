// A quick look at what the live site is actually serving.
const B = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";

const checks = [
  ["home renders", "/", (t) => t.includes("আজকের") && t.includes("বাজারদর")],
  ["hero figure", "/", (t) => t.includes("ledger-figure")],
  ["statistics strip", "/", (t) => t.includes('class="stats"')],
  ["T-1 note", "/", (t) => t.includes("stamp-note")],
  ["ledger sheet", "/", (t) => t.includes('class="sheet"')],
  ["provenance column", "/", (t) => t.includes("c-prov")],
  ["footer", "/", (t) => t.includes("foot-grid")],
  ["canonical", "/", (t) => t.includes('rel="canonical"')],
  ["JSON-LD Dataset", "/", (t) => t.includes('"@type":"Dataset"')],
  ["fact page", "/price/onion-new-833/dhaka/2026-10-19", (t) => t.includes("পেঁয়াজ")],
];

(async () => {
  let pass = 0;
  for (const [name, path, test] of checks) {
    const res = await fetch(B + path);
    const body = await res.text();
    const ok = res.status < 500 && test(body);
    if (ok) pass++;
    console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(20)} ${res.status}`);
  }
  const a = await (await fetch(B + "/api/v1/answer?q=" + encodeURIComponent("পেঁয়াজ ঢাকা"))).json();
  console.log("\nanswer:", a.answer);
  console.log("citation:", a.citation);
  console.log(`\n${pass}/${checks.length} rendered as expected`);
})();
