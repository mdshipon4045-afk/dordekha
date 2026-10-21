// Print the rendered body regions of the home page, so an empty section is
// visible rather than inferred.
const base = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";
const t = await (await fetch(base + "/")).text();
const body = t.slice(t.indexOf("</style>"));

for (const marker of ['class="ledger"', 'class="movers"', 'class="ledger-figure"']) {
  const i = body.indexOf(marker);
  console.log(`--- ${marker} at ${i} ---`);
  if (i >= 0) console.log(body.slice(i, i + 700).replace(/\n\s*\n/g, "\n"));
  console.log();
}
