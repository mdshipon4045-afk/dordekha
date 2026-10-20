# দরদেখা (Dordekha)

> বাংলাদেশের সরকারি কৃষি বাজারদর — প্রতিদিন, ইউনিট-সংশোধিত, যাচাইযোগ্য, AI-নেটিভ।

একটি zero-budget, self-operating micro-SaaS যেটা কৃষি মন্ত্রণালয়ের (কৃষি বিপণন অধিদপ্তর, DAM) অফিসিয়াল
দৈনিক বাজারদর রিপোর্ট থেকে তৈরি হয়, এবং AI সহকারীদের জন্য এমনভাবে প্রকাশ করে যাতে তারা সরাসরি
আমাদের থেকে তথ্য নিতে ও উদ্ধৃতি দিতে পারে।

---

## কী আছে

| স্তর | কী |
|---|---|
| **উৎস** | `moa-services.com/agri-service` — কৃষি মন্ত্রণালয়ের অফিসিয়াল JSON API। keyless, no cookie, no CSRF। ৬৪ জেলা · ৫০৫ উপজেলা · ৪৪৭ পণ্য · খুচরা + পাইকারি · ~১৬ মাসের আর্কাইভ |
| **সংশোধন** | ইউনিট নরমালাইজেশন (upstream "কুইন্টাল" আসলে ১০০ কেজি), গ্যাপ-সততা, পুরোনো মান চিহ্নিতকরণ |
| **প্রকাশ** | server-rendered বাংলা HTML · `text/markdown` · `application/json` · প্রতি তথ্যের canonical permalink · JSON-LD `Dataset` |
| **AI ইন্টারফেস** | MCP server (stateless, spec 2026-07-28) — প্রতিটি ফলাফলে `url`, তাই অ্যাসিস্ট্যান্ট ক্লিকযোগ্য উৎস দেখায় |
| **অপারেশন** | Cloudflare Workers + D1 + KV + R2 — পুরোটা free tier-এ, ইউজারের হাত দিতে হয় না |

---

## ডিরেক্টরি

```
src/
  index.ts      HTTP router: pages, API, MCP, robots, llms.txt, sitemap
  moa.ts        upstream client (keyless, retried, 64-district iteration)
  units.ts      unit normalisation — measured factors + plausibility repair
  normalize.ts  Bangla numerals, carry-forward detection, anomaly flags
  db.ts         D1 access layer (index-friendly reads only)
  ingest.ts     self-chaining cron job (10 ms CPU budget on the free plan)
  render.ts     one set of facts → html / markdown / json
  mcp.ts        MCP server: server/discover, tools/list, tools/call
  slug.ts       Bangla → ASCII transliteration
migrations/     D1 schema
test/           unit tests (25)
tools/          live probes against the upstream API
docs/           dataset, methodology, deployment
```

---

## চালানো

```bash
npm install
npm test                 # 25 unit tests
npx tsc --noEmit         # typecheck
npx wrangler d1 migrations apply dordekha --local
npx wrangler dev --local --port 8787 \
  --var "SITE_ORIGIN:http://localhost:8787" \
  --var "SOURCE_NAME:কৃষি মন্ত্রণালয় / কৃষি বিপণন অধিদপ্তর (DAM)" \
  --var "SOURCE_API:https://moa-services.com/agri-service"
```

তারপর:
```
POST /internal/master/refresh     → মাস্টার ডেটা
POST /internal/ingest/start       → ইনজেস্ট শুরু (নিজে নিজে চেইন করে)
GET  /health                      → "আজ ডেটা ঢুকেছে কি না"
```

---

## API

```
GET /api/v1/latest?district=47
GET /api/v1/price?commodity=পেঁয়াজ&district=পাবনা
GET /api/v1/series.csv?commodity=602&district=47
GET /api/v1/districts
GET /api/v1/commodities
```

## MCP

```bash
opencode mcp add dordekha --url https://<domain>/mcp
```

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"get_market_price",
           "arguments":{"commodity":"পেঁয়াজ","district":"পাবনা"}}}
```

টুল: `get_market_price` · `compare_districts` · `get_price_trend` · `verify_claim`

---

## সততার নীতি

1. প্রতিটি সংখ্যার সাথে উৎস, তারিখ ও ইউনিট-গুণক সংরক্ষিত থাকে।
2. যেখানে উৎসে তথ্য নেই, সেখানে কোনো সংখ্যা তৈরি করা হয় না।
3. যেখানে ইউনিট সংশোধন করতে হয়েছে, সেটি স্পষ্ট লেখা থাকে।
4. কোনো অনুমান বা ইন্টারপোলেশন করা হয় না।

বিস্তারিত: [`docs/DATASET.md`](docs/DATASET.md) · পদ্ধতি: `/methodology` পাতা
