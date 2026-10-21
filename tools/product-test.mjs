// The product test: a shopkeeper's question, asked the way an assistant
// would ask it, through to a citation that can be opened.
const base = process.env.BASE ?? "https://dordekha.shouroveh9.workers.dev";

async function mcp(name, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (await r.json()).result;
}

const questions = [
  ["ঢাকায় আজ পেঁয়াজ কত টাকা?", { commodity: "পেঁয়াজ", district: "ঢাকা" }],
  ["onion price in dhaka", { commodity: "onion", district: "dhaka" }],
  ["সিলেটে চালের দর", { commodity: "চাল", district: "সিলেট" }],
  ["পাবনায় সয়াবিন তেল", { commodity: "সয়াবিন তেল", district: "পাবনা" }],
];

for (const [q, args] of questions) {
  const res = await mcp("get_market_price", args);
  const sc = res.structuredContent;
  console.log(`Q: ${q}`);
  if (res.isError || !sc) {
    console.log(`   ERROR: ${res.content?.[0]?.text}\n`);
    continue;
  }
  console.log(`   ${sc.commodity.bn} — ${sc.district.bn}, ${sc.price_date}`);
  console.log(`   খুচরা ${sc.retail.min}–${sc.retail.max} টাকা/${sc.retail.unit_bn} (মধ্যম-পরিমাণ ${sc.retail.avg})`);
  console.log(`   উদ্ধৃতি: ${sc.url}`);

  // The citation has to resolve, and it has to show the same number.
  const page = await fetch(sc.url + ".json");
  const pj = await page.json();
  const same =
    pj.prices?.retail?.min === sc.retail.min && pj.prices?.retail?.max === sc.retail.max;
  console.log(`   লিংকে যাচাই: ${page.status} · সংখ্যা মিলেছে: ${same ? "হ্যাঁ ✅" : "না ❌"}\n`);
}

// The claim check, on the claim the audit said was wrongly rejected.
const v = await mcp("verify_claim", { claim: "পেঁয়াজ ৬০ টাকা ঢাকায়" });
console.log("যাচাই: " + v.content[0].text.split("\n").slice(0, 3).join("\n"));
