# দরদেখা (Dordekha)

> বাংলাদেশের সরকারি কৃষি বাজারদর — প্রতিদিন, ইউনিট-সংশোধিত, যাচাইযোগ্য, AI-নেটিভ।

একটি zero-budget, self-operating micro-SaaS যেটা কৃষি মন্ত্রণালয়ের (কৃষি বিপণন অধিদপ্তর, DAM) অফিসিয়াল
দৈনিক বাজারদর রিপোর্ট থেকে তৈরি হয়, এবং AI সহকারীদের জন্য এমনভাবে প্রকাশ করে যাতে তারা সরাসরি
আমাদের থেকে তথ্য নিতে ও উদ্ধৃতি দিতে পারে।

---

## কী আছে

| স্তর | কী |
|---|---|
| **উৎস** | `moa-services.com/agri-service` — কৃষি মন্ত্রণালয়ের অফিসিয়াল JSON API। keyless, no cookie, no CSRF। ৬৪ জেলা · ৪৪৭ পণ্যের ক্যাটালগ (যার তথ্য আছে ২৫৬) · খুচরা + পাইকারি · ইতিহাস প্রতিদিন ১ দিন করে বাড়ে |
| **সংশোধন** | ইউনিট নরমালাইজেশন (upstream "কুইন্টাল" আসলে ১০০ কেজি), গ্যাপ-সততা, পুরোনো মান চিহ্নিতকরণ, ব্যাপ্তির বাইরের গড় সংশোধন ও চিহ্নিতকরণ |
| **প্রকাশ** | server-rendered বাংলা HTML · `text/markdown` · `application/json` · প্রতি তথ্যের canonical permalink · JSON-LD `Dataset` |
| **AI ইন্টারফেস** | MCP server (stateless, spec 2026-07-28) — প্রতিটি ফলাফলে `url`, তাই অ্যাসিস্ট্যান্ট ক্লিকযোগ্য উৎস দেখায় |
| **অপারেশন** | Cloudflare Workers + D1 + KV — পুরোটা free tier-এ, ইউজারের হাত দিতে হয় না |

---

## ডিরেক্টরি

```
src/
  index.ts      HTTP router: pages, API, MCP, robots, llms.txt, sitemap, openapi
  moa.ts        upstream client (keyless, retried, 64-district iteration)
  units.ts      unit normalisation — measured factors + plausibility repair
  normalize.ts  Bangla numerals, carry-forward detection, anomaly flags
  quality.ts    what may be published: clamping, range repair, is_midpoint
  db.ts         D1 access layer — every read falls back to the KV cache
  cache.ts      KV snapshot, aggregates, master data, history
  ingest.ts     self-chaining cron job (10 ms CPU budget on the free plan)
  resolve.ts    a name or a sentence → the right commodity or district
  bn.ts         Bangla normalisation (nukta, virama, aliases)
  render.ts     one set of facts → html / markdown / json
  docs.ts       one content model → html / markdown / json
  mcp.ts        MCP server: server/discover, tools/list, tools/call
  slug.ts       Bangla → ASCII transliteration
migrations/     D1 schema
test/           unit tests (75)
tools/          snapshot builder, verification harnesses, live probes
docs/           dataset, methodology, licence letter, audit prompts
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
GET /api/v1/latest?district=47          (জেলা আইডি বা নাম — নাম দিলেও চলে)
GET /api/v1/price?commodity=পেঁয়াজ&district=পাবনা
GET /api/v1/price?commodity=833&district=47&date=2026-10-19
GET /api/v1/search?q=পেঁয়াজ ঢাকা
GET /api/v1/answer?q=পেঁয়াজ ঢাকা        (উত্তর + উদ্ধৃতি, একটি অবজেক্টে)
GET /api/v1/series.csv?commodity=602&district=47
GET /api/v1/districts
GET /api/v1/commodities
GET /api/v1/units                        (ইউনিট কোডের লেজেন্ড)
```

সব উত্তরে `price_date`, `unit_bn`, `is_midpoint` এবং প্রতিটি সারির নিজস্ব
উদ্ধৃতিযোগ্য `url` থাকে। OpenAPI স্পেক: `/openapi.json`

## MCP

```bash
opencode mcp add dordekha --url https://dordekha.shouroveh9.workers.dev/mcp
```

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"get_market_price",
           "arguments":{"commodity":"পেঁয়াজ","district":"পাবনা"}}}
```

টুল: `get_market_price` · `compare_districts` · `get_price_trend` · `verify_claim`

Registry-তে প্রকাশের নির্দেশনা: [`docs/PUBLISH-MCP.md`](docs/PUBLISH-MCP.md)

---

## সততার নীতি

1. প্রতিটি সংখ্যার সাথে উৎস, তারিখ ও ইউনিট-গুণক সংরক্ষিত থাকে।
2. যেখানে উৎসে তথ্য নেই, সেখানে কোনো সংখ্যা তৈরি করা হয় না।
3. যেখানে ইউনিট সংশোধন করতে হয়েছে, সেটি স্পষ্ট লেখা থাকে।
4. কোনো অনুমান বা ইন্টারপোলেশন করা হয় না।
5. উৎসের তৃতীয় সংখ্যা "(ন্যূনতম+সর্বোচ্চ)/2" — এটি গড় নয়, তাই "মধ্যম-পরিমাণ"
   বলা হয় এবং প্রতিটি সারিতে `is_midpoint` থাকে।
6. কোনো সংখ্যার দাবি হাতে-কলমে লেখা থাকে না — রেন্ডারের সময় ডেটা থেকে গোনা হয়।

বিস্তারিত: [`docs/DATASET.md`](docs/DATASET.md) · পদ্ধতি: `/methodology` পাতা

---

## 📚 ডকুমেন্ট

| ফাইল | কী |
|---|---|
| [`PLAN.md`](PLAN.md) | সিদ্ধান্ত, পরিকল্পনা, ফেজ, মানবিক কাজের তালিকা |
| [`docs/FAILURE-MODES.md`](docs/FAILURE-MODES.md) | **ফেইলার রেজিস্টার + বর্তমান অবস্থা** — কোড থেকে শুরু করলে এখানেই যান |
| [`docs/MASTER-PROMPT.md`](docs/MASTER-PROMPT.md) | একটি শীর্ষস্তর AI-কে পুরো প্রজেক্ট চালানোর দায়িত্ব দেওয়ার প্রম্পট |
| [`docs/DEEP-REVIEW-PROMPT.md`](docs/DEEP-REVIEW-PROMPT.md) | গভীর কোড + ব্যবসা + আইনি পর্যালোচনার প্রম্পট |
| [`docs/AUDIT-PROMPTS.md`](docs/AUDIT-PROMPTS.md) | চারটি অডিট প্রম্পট (২১ অক্টোবরে চালানো হয়েছে) |
| [`docs/DATASET.md`](docs/DATASET.md) | ডেটাসেটের পরিধি ও পদ্ধতি |
| [`docs/licence-letter-DAM.md`](docs/licence-letter-DAM.md) | DAM/ডিসিম লাইসেন্স চিঠির খসড়া |
| [`docs/OUTREACH-KIT.md`](docs/OUTREACH-KIT.md) | B2B আউটরেচ: প্রোসপেক্ট, ইমেইল টেমপ্লেট, ফেসবুক পোস্ট |
| [`docs/PUBLISH-MCP.md`](docs/PUBLISH-MCP.md) | MCP Registry-তে প্রকাশের নির্দেশনা |

---

## যাচাই

```bash
npx vitest run                                    # 75 unit tests
$env:BASE="https://dordekha.shouroveh9.workers.dev"; node tools/e2e.mjs   # 60 live checks
node tools/verify-audit.mjs                       # 32 audit claims
node tools/peek.mjs                               # 12 render checks
node tools/product-test.mjs                       # question → citation → same number
```
