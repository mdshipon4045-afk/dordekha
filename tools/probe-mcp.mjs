// Call the MCP server and print what it says, so a matching failure can be
// seen with the exact bytes that were sent.
const base = process.env.BASE ?? "https://dordekha.pages.dev";

async function call(name, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = await r.json();
  console.log(`--- ${name} ${JSON.stringify(args)} ---`);
  console.log(j.result?.content?.[0]?.text ?? JSON.stringify(j).slice(0, 400));
  console.log();
}

await call("get_market_price", { commodity: "সয়াবিন তেল", district: "ঢাকা" });
await call("get_market_price", { commodity: "সয়াবিন", district: "ঢাকা" });
await call("get_market_price", { commodity: "তেল", district: "ঢাকা" });
await call("get_market_price", { commodity: "Soybean Oil", district: "ঢাকা" });
await call("get_market_price", { commodity: "পেঁয়াজ", district: "ঢাকা" });
await call("verify_claim", { claim: "পেঁয়াজ ৬০ টাকা ঢাকায়" });
await call("verify_claim", { claim: "onion 60 taka in dhaka" });
