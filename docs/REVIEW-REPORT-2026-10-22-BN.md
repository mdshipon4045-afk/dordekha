# 🔍 রিভিউ রিপোর্ট — দরদেখা · ২২ অক্টোবর ২০২৬

> **রিভিউয়ার:** সিনিয়র ইঞ্জিনিয়ার, ঠান্ডা মাথায়
> **পরীক্ষা করা:** সম্পূর্ণ কোড (`src/`, `test/`, `migrations/`, `tools/`, `pages/`, `wrangler.jsonc`),
> লাইভ সাইট, লাইভ D1, লাইভ KV, Cloudflare GraphQL অ্যানালিটিক্স, Git হিস্টোরি, GitHub API
> **পদ্ধতি:** দাবি = প্রমাণ। যা যাচাই করা যায়নি তা "অনুমান" চিহ্নিত।
> **টেস্ট:** `npm test` → ১৪০/১৪০ পাস · `node tools/e2e.mjs` → ৬০/৬০ পাস (লাইভ)

> ### ⚠️ রিভিউ-এর ভিত্তি (baseline)
> **কমিট `29eba52` ("fix(mcp): the machine-readable verdict and the text now agree")।**
>
> **রিপো রিভিউ চলাকালীনই বদলেছে** — অন্য একটি এজেন্ট সমান্তরালে কাজ করছে:
> ```
> 10:06:40  dee1525  fix(price-index): the list showed an empty price for most of the catalogue
> 10:29:16  bc52f77  feat(paid): the commercial tier is open        ← Critical #২-এর কারণ
> 10:50:39  66e3ac1  feat(mail): the mailbox can be swept
> 10:55:45  69a3f48  docs: the prompt a customer's ai gets…
> 11:00:22  cc662e4  docs: the prompt that makes another ai audit the project
> 11:07:45  29eba52  fix(mcp): …                                   ← এই রিভিউয়ের baseline
> ```
> ১১:০৭:৫১ UTC-তে GitHub-এ push হয়েছে (`pushed_at: 2026-10-22T05:07:51Z`)।
> **তাই যেকোনো ফাইল বদলানোর আগে প্রতিটি ফাইন্ডিং নির্দিষ্ট কমিটের বিরুদ্ধে আবার যাচাই করুন** —
> সম্ভবত কিছু আগেই সেরে ফেলা হয়ে গেছে।

---

## সারসংক্ষেপ — যা পাওয়া গেছে

| # | তীব্রতা | সমস্যা | প্রমাণের ধরন |
|---|---|---|---|
| ১ | 🔴 Critical | জাতীয় পরিচয়পত্র + ঠিকানা গিট ইতিহাসে লিক; রিপো **ইতিমধ্যে public** | GitHub API + raw.githubusercontent 200 OK |
| ২ | 🔴 Critical | লাইসেন্স আসার আগেই বাণিজ্যিক প্ল্যান বিক্রি — `LICENCE_GRANTED` প্রোডাকশন সিক্রেটে সেট | `wrangler secret list` + কোড |
| ৩ | 🔴 Critical | KV রাইট বাজেট প্রতি-মিনিটের ক্রনে **৮.৬ গুণ** ছাড়ানো; প্রতিটি লেখার ত্রুটি নিঃশব্দে ছাড়া হচ্ছে | কোডের হিসাব + লাইভ KV-র অসম্পূর্ণ শার্ড |
| ৪ | 🔴 Critical | D1 রিড কোটা ২১ অক্টোবরে ভাঙেছে: **৭,৩২৬,৪২৭ সারি** (সীমা ৫,০০০,০০০) | Cloudflare GraphQL |
| ৫ | 🟠 Important | সাইট নিজের ডেটাসেটের সারি-সংখ্যা ও দিন-সংখ্যা সত্য থেকে **১৫% কম** প্রকাশ করছে | /health + llms.txt বনাম সরাসরি D1 |
| ৬ | 🟠 Important | জাতীয় স্কোপে `min`/`max` আসলে p10/p90 — কোথাও লেখা নেই | live `/api/v1/price?commodity=837` |
| ৭ | 🟠 Important | জাতীয় গড় ও "সবচেয়ে সস্তা জেলা" **মিশ্র তারিখের** সারি থেকে, তবু `price_date` = নতুন | live + D1 |
| ৮ | 🟠 Important | `/api/v1/latest` মিশ্র তারিখের সারি একটি তারিখের নিচে | live (ঢাকা: ৯৩+৫+১ সারি) |
| ৯ | 🟠 Important | `verify_claim` ঢাকার দরকে **"জেলা-গড় / national average"** বলে | live MCP |
| ১০ | 🟠 Important | যাচাই-হয়না ইউনিট-জোড়ার পাইকারি মান **raw অবস্থায় খুচরার এককে** প্রকাশ হয় | কোড |
| ১১ | 🟠 Important | carry-forward চিহ্নিত হয় কেবল খুচরা **ও** পাইকারি দুটোই মিললে | কোড |
| ১২ | 🟠 Important | মূল্য পেজের প্ল্যান কোডের সাথে মেলে না — দুটো পণ্য কিনতে কোড-পথ নেই | কোড বনাম কোড |
| ১৩ | 🟠 Important | burst guard কার্যত **১০ সেকেন্ডের** উইন্ডোতে কাজ করে, ৫ মিনিটের নয় | কোড + TTL |
| ১৪ | 🟠 Important | MCP ত্রুটিপূর্ণ বডিতে JSON-RPC `-32700` নয়, **503** | live |
| ১৫ | 🟠 Important | MCP CORS preflight (OPTIONS) **405** — ডেড কোড | live + কোড |
| ১৬ | 🟠 Important | CSV এক্সপোর্টে **এককের কলাম নেই, উৎসের উল্লেখ নেই** | live |
| ১৭ | 🟠 Important | `ingest_run` টেবিলে প্রতিটি তারিখের সারি-সংখ্যা ভুল লেখা হচ্ছে (শুধু শেষ ব্যাচ) | কোড + D1 |
| ১৮ | 🟠 Important | D1 রাইটও ফ্রি-টায়ার সীমার **৩.৮ গুণ** (৩৮১,৩৮৯ সারি/দিন) | GraphQL |
| ১৯ | 🟠 Important | `ADMIN_TOKEN` কোয়েরি প্যারামিটারেও নেওয়া হয় | কোড |
| ২০ | 🟡 Minor | `moversOrSnapshot` ইতিহাসের **লিগ্যেসি** একক-কী পড়ে; সেটি ২৩ অক্টোবরে মরে যাবে | কোড + KV TTL |
| ২১ | 🟡 Minor | ইনজেস্ট-রানে আটকে থাকা ৫টি `running` সারি | D1 |
| ২২ | 🟡 Minor | ব্যক্তিগত তথ্য (bKash, ইমেইল, মোবাইল, নাম, বাড়ির ঠিকানা) ট্র্যাকড ও লাইভ | git + কোড |
| ২৩ | 🟡 Minor | রিপোজিটরিতে কোনো LICENSE ফাইল নেই, অথচ সাইট লাইসেন্স দাবি করে | GitHub API |
| ২৪ | 🟡 Minor | `divisor` ধারণার তিন রকম নামকরণ একই ধাপে | কোড |
| ২৫ | 🟡 Minor | MCP ব্যাচ (অ্যারে) অনুরোধ `-32601` দেয় | live |
| ২৬ | 🟡 Minor | অ-কী অনুরোধে কোনো রেট-লিমিট নেই — ফ্রি টায়ার অরক্ষিত | কোড |
| ২৭ | 🟠 Important | D1 বন্ধ হলে **তারিখ-নির্দিষ্ট পার্মালিংক ৪০৪** দেয় — শার্ডযুক্ত ইতিহাস উপেক্ষিত | কোড + KV TTL |
| ২৮ | 🟠 Important | `recordUsage`-এর ফলব্যাক মাস/উইন্ডো রোলওভার করে না → কোটা ও বার্স্ট চিরকাল অকার্যকর | কোড |
| ২৯ | 🟡 Minor | জাতীয় (district 0) সারির `retail_avg` = সর্বনিম্ন দাম; ২৩৯টি `price_latest`-এ | D1 |
| ৩০ | 🟡 Minor | রিপোর্ট-দিন খোঁজা ঢাকার উপর নির্ভরশীল — ঢাকা বাদ পড়লে পুরো দিন বাদ যায় | কোড + উৎস |
| ৪০ | 🟠 Important | Pages ফ্রন্ট **MCP-Protocol-Version, CORS, provenance হেডার ছেঁড়ে দেয়** | live দুই হোস্ট তুলনা |
| ৪১ | 🟠 Important | `/openapi.json` **৪০৪** — llms.txt-এর "machine-readable contract" নেই | live + কোড |
| ৪২ | 🟠 Important | জাতীয় "গড়"-এর **তিনটি ভিন্ন সংখ্যা** (44.5 / 44.94 / 45.2) ও উত্তর নিজের সাথে অসামঞ্জস্য | live |
| ৪৩ | 🟠 Important | `/api/v1/answer` ও `/api/v1/price` একই প্রশ্নে আলাদা আকৃতি | live |
| ৪৪ | 🟠 Important | llms.txt বলছে "উপজেলার তথ্য নেই", `/dataset` বলছে "৫০৫ উপজেলা, প্রকাশ করা হচ্ছে" | live |
| ৪৫ | 🟡 Minor | ৫০৩ degraded উত্তর `Cache-Control: public, max-age=600` — ত্রুটি ১০ মিনিট ক্যাশ হয় | live |
| ৪৬ | 🟡 Minor | MCP-এ `source` শুধু নাম (URL নেই); `get_price_trend`-এ top-level `price_date` নেই | live |
| ৪৭ | 🟡 Minor | robots.txt CSV নিষিদ্ধ করে, llms.txt ও /api তা বিজ্ঞাপন করে | কোড |
| ৪৮ | 🟡 Minor | নেভিগেশনের "MCP" লিংক ৪০৫ দেয় — কোনো ডক পেজ নেই | live |
| ১০-ব | 🟡 Minor | "সবচেয়ে ব্যস্ত জেলা" ক্যাশ-পথে (রাঙ্গামাটি) ও ডিবি-পথে (খাগড়াছড়ি) আলাদা | কোড + D1 |
| ১৬-ব | 🟡 Minor | প্রতি-মিনিটের ক্রনের প্রতিটি টিকে কত সারি পড়া হচ্ছে — মাপা | কোয়েরির `rows_read` |
| ১৮-ব | 🟠 Important | ক্যাচ-প্রথম পথ ও D1-পথ একই প্রশ্নে আলাদা উত্তর দেয় | কোড + D1 |
| ২১-ব | 🟠 Important | ইনজেস্ট আংশিক ব্যর্থ হলে `price_latest` আটটি তারিখে বিভক্ত | D1 |
| ৩১ | 🟡 Minor | একটি keyed কল **দুটো** রাইট করে, কিন্তু কোডের মন্তব্য "একটি রাইট" বলে | কোড |
| ৩৩ | 🟡 Minor | গ্রাহকের তথ্য জমা হয় ও লগে যায় কি না — ইমেইল লগে না, `usage_event`-এ নেই ✅ | কোড |
| ৩৯ | 🟡 Minor | MCP `tools/call` ইনপুট স্কিমা যাচাই করে না — `days:"abc"` → অভ্যন্তরীণ RangeError | কোড |

---

## ১. সত্যতা ও সংখ্যার শুদ্ধতা

### [Critical] ১. জাতীয় পরিচয়পত্র, পিতার নাম ও ঠিকানা গিট ইতিহাসে — রিপো ইতিমধ্যে public

**ফাইল:** `docs/OWNER-CHECKLIST-BN.md` (কমিট `d5ed239`), `docs/licence-letter-FINAL.txt:6,102,123`,
`docs/licence-letter-DAM.md:28,93`, `docs/CUSTOMER-PROMPT-BN.md:89`, `src/docs.ts:614`, `wrangler.jsonc:72-73`

**সমস্যা:** বাংলাদেশের জাতীয় পরিচয়পত্র (NID), পিতার নাম, গ্রামের ঠিকানা, উপজেলা ও জেলা — এবং
ব্যক্তিগত ইমেইল, মোবাইল, bKash ওয়ালেট — সবই গিট ইতিহাসে আছে, এবং রিপোজিটরি **এই মুহূর্তে public**।

**প্রমাণ:**
```bash
# GitHub API
curl -s https://api.github.com/repos/mdshipon4045-afk/dordekha | grep -E '"private"|"visibility"|"license"'
# → "private":false , "visibility":"public" , "license":null

# লিক করা ফাইলটি সরাসরি পড়া যাচ্ছে
curl -s https://raw.githubusercontent.com/mdshipon4045-afk/dordekha/d5ed239e434a7c0f61896251b0460ca8811df941/docs/OWNER-CHECKLIST-BN.md
```
ফাইলে লেখা আছে (ভেরিফায় করা):
> `বিষয়বস্তু: নাম শৌরভ হাসান, পিতা সাইয়েদুল আলম, গ্রাম ফেরেঙ্গে পাড়া, ট্রিমোহন, উপজেলা মিরজাপুর, জেলা টাঙ্গাইল, পরিচয়পত্র 9600675665 ✅।`

ট্যাগ `v1.0.1` (= `733b40a`) এখনও ঠিকানার লাইনগুলো ধরে আছে:
`https://raw.githubusercontent.com/mdshipon4045-afk/dordekha/733b40a64c34b83e68258bda66782e7ad410192b/docs/OWNER-CHECKLIST-BN.md` → 200 OK

**HEAD-এ NID নেই** (কমিট `28c5cba` মুছে দিয়েছে) — কিন্তু Git ইতিহাস মুছে যায় না:
```bash
# সরাসরি GitHub-এ সেই কমিটটি এখনও পড়া যায়
curl -s -o /dev/null -w "%{http_code}\n" \
  https://api.github.com/repos/mdshipon4045-afk/dordekha/commits/d5ed239e434a7c0f61896251b0460ca8811df941
# → 200
# ট্যাগগুলো public রিপোতে আছে
curl -s https://api.github.com/repos/mdshipon4045-afk/dordekha/git/refs/tags
# → refs/tags/v1.0.0 -> b2d7f16…, refs/tags/v1.0.1 -> 733b40a…  ← ঠিকানার ব্লক এখানে
```

**প্রভাব:** NID + ঠিকানা এখন ইন্টারনেটে খোলা। এটি চিহ্নিত করা, ইতিহাস থেকে মুছে ফেলা হলেও
GitHub-এর dangling blob ও fork থেকে থেকে যায়। এছাড়া `docs/licence-letter-FINAL.txt`-এ
`shourovehasan23@gmail.com` ও মোবাইল `০১৭৩০৫৩৪৯৫৫` **HEAD-এ এখনও** আছে, এবং
`src/docs.ts:614` থেকে bKash নম্বর **লাইভ `/pricing` পেজে** প্রকাশিত হচ্ছে।

**সমাধান (এখনই, এই ক্রমে):**
```bash
# ১. এখনই private করুন
gh repo edit mdshipon4045-afk/dordekha --visibility private

# ২. ইতিহাস পরিষ্কার (git-filter-repo ইনস্টল করে)
git filter-repo --path docs/OWNER-CHECKLIST-BN.md --invert-paths
git filter-repo --path docs/licence-letter-FINAL.txt --invert-paths
git filter-repo --path docs/licence-letter-DAM.md --invert-paths
git filter-repo --path docs/CUSTOMER-PROMPT-BN.md --invert-paths
git filter-repo --path "docs/Audit-Prompts report by multipul ai.txt" --invert-paths
git remote add origin https://github.com/mdshipon4045-afk/dordekha
git push --force --tags origin master     # ট্যাগ v1.0.1 মুছে যাবে
# GitHub: Settings → Danger zone → "Delete all tags" তারপর নতুন ট্যাগ

# ৩. NID বদলানোর আবেদন (BD তে জেলা প্রশাসকের অনুমতি লাগে)

# ৪. HEAD থেকে ইমেইল/মোবাইল/NID সরান; runtime-এ env থেকে আসুন
```
`src/docs.ts:614`-এর বদলে:
```ts
code: `bKash (ব্যক্তিগত): ${ctx.bkashNumber ?? "যোগাযোগের জন্য ইমেইল করুন"}
ইমেইল: অনুরোধের সাথে আসবে
ওয়েবসাইট: ${ctx.origin.replace(/\/$/, "")}`,
```
(এরপর `RenderContext`-এ `bkashNumber?: string` যোগ করে `ctxFor()`-এ `env.BKASH_NUMBER` বসান,
আর `wrangler.jsonc`-এর `vars.BKASH_NUMBER`-কে একটি Worker **secret**-এ সরান — `vars` public।)

---

### [Important] ৫. সাইট নিজের ডেটাসেটের সারি-সংখ্যা ও দিন-সংখ্যা সত্য থেকে ১৫% কম

**ফাইল:** `src/cache.ts:154-199` (`computeAggregatesFromCache`), `src/cache.ts:474-497` (`setHistoryDate`),
`src/cache.ts:538-559` (`recountHistory`), `src/index.ts:186` (`getAggregates`)

**সমস্যা:** সাইটের প্রকাশিত "কত সারি" ও "কত দিনের ইতিহাস" D1 থেকে নয়, **KV-র ইতিহাস-ম্যানিফেস্ট থেকে**
গোনা হয়। আর ম্যানিফেস্টে একটি তারিখই নেই যেটা D1-তে আছে। ফলে সাইট নিজের ডেটাসেট সম্পর্কে
ভুল সংখ্যা বলছে — যেটা একটি অ্যাসিস্ট্যান্ট হুবহু উদ্ধৃত করবে।

**প্রমাণ:**
```bash
# সাইট যা বলছে
curl -s https://dordekha.pages.dev/health
# → { "ok": true, "latest_date": "2026-10-19", "rows": 24163 }
curl -s https://dordekha.pages.dev/llms.txt | grep "History currently held"
# → **History currently held: 2026-06-24 থেকে 2026-10-19 (10টি প্রতিবেদনের তারিখ)**

# সত্য (D1)
npx wrangler d1 execute dordekha --remote --command \
 "SELECT COUNT(*) n, COUNT(DISTINCT price_date) d, MIN(price_date) f, MAX(price_date) l FROM price_daily"
# → n=28382, d=11, f=2026-06-23, l=2026-10-19
```
| | সাইট প্রকাশ করছে | D1-তে আছে | পার্থক্য |
|---|---|---|---|
| সারি | ২৪,১৬৩ | ২৮,৩৮২ | **−৪,২১৯ (−১৫%)** |
| প্রতিবেদনের দিন | ১০ | ১১ | −১ |
| প্রথম তারিখ | 2026-06-24 | 2026-06-23 | −১ দিন |

গায়েব ৪,২১৯ সারি = **২০২৬-১০-১৭-এর ৩,৭৫০ সারি + ২০২৬-০৬-২৩-এর ২৩০ সারি**।
লাইভ KV-র `history:index` ম্যানিফেস্টে ২০২৬-১০-১৭ **নেইই** (৯টি তারিখ আছে):
```
2026-06-24 districts=61 rows=3772 | 2026-06-25 60/3695 | 2026-06-26 1/35
2026-06-27 1/40 | 2026-06-28 58/3639 | 2026-06-29 58/3634
2026-06-30 27/1734 | 2026-10-18 61/3953 | 2026-10-19 56/3661
```
কিন্তু ২০২৬-১০-১৭ D1-তে আছে (৩,৭৫০ সারি) এবং `ingest_run`-এ সেই তারিখের স্কোপও আছে (`id=12`)।
**যে তারিখ স্ক্যান করা হয়েছে, তার শার্ড ও ম্যানিফেস্ট-এন্ট্রি লেখা হয়নি** — এটাই #৩-এর লক্ষণ।

**প্রভাব:** `/health`, `/llms.txt`, `/dataset`, `/methodology`, হোম পেজের স্ট্যাটিস্ট্রিপ — সব জায়গায়
ডেটাসেটের আকার ভুল বলা হচ্ছে। "৬০/৬০ e2e পাস" হওয়া সত্ত্বেও কোনো টেস্ট এই অমিল ধরে না।

**আরেকটি মাত্রা (লাইভ-প্রোব):** প্রকাশিত "১০টি প্রতিবেদনের দিন"-এর বদলে **পাবলিক API আসলে ৮টি
তারিখই** খুঁজে পাওয়া যায় — `2026-06-24, 06-25, 06-28, 06-29, 06-30, 10-17, 10-18, 10-19`
(৬৪টি জেলার `/api/v1/latest?district=N` স্ক্যান করে যাচাই করা)। ০৬-২৬ ও ০৬-২৭ মাত্র ১টি
জেলার সারি আছে, তাই public কোনো পণ্য-জেলা জোড়ায় দেখা যায় না। **অর্থাৎ "১০ দিন"-এর দাবিটি
প্রকাশিত সারি থেকে আসে, প্রকৃত প্রকাশযোগ্য তথ্য থেকে নয়।**

**সমাধান:**
- (ক) মূল সমস্যা: #৩ ঠিক করুন (KV লেখা)।
- (খ) ইতিহাসের গভীরতা দাবি **সরাসরি D1 থেকে** হিসাব করুন, ম্যানিফেস্ট থেকে নয় — কিন্তু সেটা
  প্রতি-অনুরোধে স্ক্যান হবে না। সমাধান: `agg:current`-এর মতো একটি আলাদা কী
  `hist:range` রাখুন, যেটি ইনজেস্ট শেষে **D1 থেকে** `historyRange()` দিয়ে হিসাব করে লেখে,
  আর `computeAggregatesFromCache` সেটাই ব্যবহার করে — ম্যানিফেস্ট নয়:
```ts
// src/cache.ts
export async function getHistoryRangeCache(env: Env): Promise<{first:string|null;last:string|null;days:number;rows:number}|null> {
  return kvGet(env, "hist:range");
}
// ingest.ts — job শেষে (লাইন ~640-এর পাশে):
await kvSet(env, "hist:range", await historyRange(env.DB), AGGREGATE_TTL);
// cache.ts — computeAggregatesFromCache-এ:
const range = await getHistoryRangeCache(env);
if (range) { return { ...computed, firstDate: range.first, days: range.days, rowCount: range.rows }; }
```
- (গ) সাইটের প্রতিটি প্রকাশিত সংখ্যার পাশে **উৎস** লিখুন (D1 না ক্যাশ) — যেমন
  "২৮,৩৮২ সারি (D1 থেকে, ২২ অক্টোবর মর্মে)"।

---

### [Important] ৬. জাতীয় স্কোপে `min`/`max` আসলে পারসেন্টাইল — কোথাও লেখা নেই

**ফাইল:** `src/index.ts:1310-1337`

**সমস্যা:** জেলা ছাড়া জিজ্ঞাসা করলে কোড ১০ম ও ৯০ম পারসেন্টাইল হিসাব করে, কিন্তু ফিল্ডের নাম
দেয় **`min` ও `max`**। কেউ `min: 75, max: 130` পড়ে ভাববে এটিই দেখা পর্যন্তের ব্যাপ্তি।

**প্রমাণ:**
```bash
curl -s "https://dordekha.pages.dev/api/v1/price?commodity=837"
# → "price_date":"2026-10-19","retail":{"min":75,"max":130,"avg":105,"median":105,...}
#    "districts_reporting":62
```
আসল সারিগুলো (D1):
```
price_daily/price_latest, commodity 837, 2026-10-19 → 56 সারি, min 45, max 155
```
অর্থাৎ **প্রকাশিত ব্যাপ্তি ৭৫–১৩০, আসল ব্যাপ্তি ৪৫–১৫৫**।
কোডের মন্তব্যে লেখা আছে "A median and percentiles rather than a min/max" — কিন্তু
প্রকাশিত ক্ষেত্রে সেটা বলা নেই।

**প্রভাব:** একটি অ্যাসিট্যান্ট `retail.min`/`retail.max` পড়ে বাজারের প্রকৃত ব্যাপ্তি হিসেবে
উদ্ধৃত করবে — ৩৫ টাকা/কেজি ভুল।

**সমাধান:** ক্ষেত্রের নাম বদলে পারসেন্টাইল বলুন, অথবা একটি নোট যোগ করুন:
```ts
retail: {
  p10: Math.round(low * 100) / 100,
  p90: Math.round(high * 100) / 100,
  min: Math.round(Math.min(...avgs) * 100) / 100,
  max: Math.round(Math.max(...avgs) * 100) / 100,
  avg: Math.round(median * 100) / 100,
  median: Math.round(median * 100) / 100,
  unit: unit ?? 2, unit_bn: ..., is_midpoint: false,
},
note: "avg/median হলো জেলাভিত্তিক মিডিয়ান; p10/p90 হলো ১০ম/৯০ম পারসেন্টাইল; min/max হলো প্রকৃত ব্যাপ্তি।",
```
(যেহেতু ইতিমধ্যে `avgs` অ্যারে আছে, `Math.min(...avgs)`/`Math.max(...avgs)` খরচ নেই।)

---

### [Important] ৭. জাতীয় গড় ও "সবচেয়ে সস্তা/বেশি জেলা" মিশ্র তারিখের সারি থেকে

**ফাইল:** `src/index.ts:1284-1340` (`searchFact`, জাতীয় পথ)

**সমস্যা:** জাতীয় পথে `price_latest`-এর সব সারি নেওয়া হয় — **তারিখ মিলিয়ে নয়**।
`price_latest`-এ একই পণ্যের সারি ১০-১৯, ১০-১৮ ও ০৬-২৮ — তিনটি তারিখে ছড়ানো। তারপর
`price_date` ক্ষেত্রে **সর্বোচ্চ** তারিখটি (১০-১৯) বসানো হয় — ফলে উত্তরে কোনো সংকেত নেই যে
অন্তত একটি সারি ৪ মাস পুরনো।

**প্রমাণ:**
```bash
npx wrangler d1 execute dordekha --remote --command \
 "SELECT price_date, COUNT(*) n, MIN(retail_avg) mn, MAX(retail_avg) mx FROM price_latest WHERE commodity_id=837 AND upazila_id=0 AND district_id>0 GROUP BY price_date"
# 2026-06-28 → 1 সারি (65)
# 2026-10-18 → 5 সারি (89..128)
# 2026-10-19 → 56 সারি (45..155)

curl -s "https://dordekha.pages.dev/api/v1/price?commodity=837"
# → "price_date":"2026-10-19", "districts_reporting":62, "cheapest_district":13, "dearest_district":48
```
`districts_reporting: 62` = ১০-১৯-এর ৫৬ + ১০-১৮-এর ৫ + ০৬-২৮-এর ১ — তিনটি আলাদা দিনের জেলা একসাথে
গোনা হয়েছে, অথচ তারিখ ১০-১৯ বলা হয়েছে।

**প্রভাব:** "জেলা-গড়", "সবচেয়ে সস্তা জেলা", "সবচেয়ে বেশি জেলা" — তিনটিই ভুল তারিখের সারি মিশিয়ে
তৈরি, আর তারিখ লেবেল মিথ্যা।

**সমাধান:** জাতীয় পথেও একই দিনের সারি বেছে নিন (MCP-র `compare_districts` এটা ইতিমধ্যে করে):
```ts
// src/index.ts, জাতীয় পথে latestForCommodityOrSnapshot-এর পরে:
const newest = withRetail.map((x) => x.r.priceDate).sort().pop() ?? ctx.latestDate;
const sameDay = withRetail.filter((x) => x.r.priceDate === newest);
if (sameDay.length < withRetail.length) {
  // বাদ পড়া সারির সংখ্যা প্রকাশ করুন
}
```
এবং উত্তরে যোগ করুন: `"districts_reporting": sameDay.length, "districts_total": withRetail.length,
"excluded_older_districts": withRetail.length - sameDay.length, "price_date": newest`।

**একই সমস্যা `commodityMedians()`-এ** (`src/db.ts:117-172`) — `/price` পেজের সব পণ্যের
"গড়" একইভাবে মিশ্র তারিখের সারি থেকে। এটিকেও একই দিনে সীমাবদ্ধ করুন।

---

### [Important] ৮. `/api/v1/latest` মিশ্র তারিখের সারি একটি তারিখের নিচে

**ফাইল:** `src/index.ts:956-1003` (বিশেষত লাইন ৯৬০: `date: ctx.latestDate`)

**সমস্যা:** এন্ডপয়েন্টের টপ-লেভেল `date` হলো **গ্লোবাল সর্বশেষ তারিখ**, কিন্তু প্রতিটি সারির
`price_date` আলাদা হতে পারে। ঢাকার ৯৯টি সারির মধ্যে ৬টি জুনের।

**প্রমাণ:**
```bash
curl -s "https://dordekha.pages.dev/api/v1/latest?district=47" | \
  powershell -c '$j = (stdin|ConvertFrom-Json); $j.date; $j.prices | Group-Object price_date | % { "$($_.Name) -> $($_.Count)" }'
# 2026-10-19        (top-level date)
# 2026-10-19 -> 93 rows
# 2026-06-30 -> 5 rows
# 2026-06-25 -> 1 rows
```
`price_latest`-এ আটটি আলাদা তারিখ আছে:
```
2026-06-24 (2 জেলা) | 06-25 (5) | 06-28 (6) | 06-29 (32) | 06-30 (20)
2026-10-17 (3) | 10-18 (15) | 10-19 (56)
```
অর্থাৎ **৬৪ জেলার মধ্যে ৫৬ জেলার ১০-১৯ তারিখের সারি আছে; বাকি ৮ জেলার সারি জুন থেকে।**

**প্রভাব:** প্রতিটি সারিতে `price_date` ও সঠিক `url` আছে (৯৯/৯৯) — তাই সাবধানী কনজিউমার
ঠিক পড়বে। কিন্তু টপ-লেভেল `date` পড়ে মাত্র একটি সারি উদ্ধৃত করলে ৪ মাস পুরনো দর ১৯ অক্টোবরের
বলে চলে যাবে।

**সমাধান:** টপ-লেভেলে তারিখের বদলে বিস্তৃতি দিন:
```ts
date: ctx.latestDate,
date_note: "প্রতিটি সারির নিজস্ব price_date আলাদা; সব সারি একই তারিখের নয়।",
date_range: { oldest: rows.map(r=>r.priceDate).sort()[0], newest: ctx.latestDate },
stale_rows: rows.filter(r => r.priceDate !== ctx.latestDate).length,
```
অথবা `rows` কে `ctx.latestDate`-এর সারিতে ছেঁকে নিন এবং পুরনোগুলো আলাদা `stale` অ্যারে দিন।

---

### [Important] ৯. `verify_claim` ঢাকার দরকে "জেলা-গড় / national average" বলে

**ফাইল:** `src/mcp.ts:626`, `src/mcp.ts:656`, `src/mcp.ts:719-721`

**সমস্যা:** দাবিতে জেলার নাম না থাকলে `verify_claim` হার্ড-কোড করে **ঢাকা (id 47)**-এর সারি পড়ে,
তারপর সেটিকে **"জেলা-গড়"** ও **"national average"** বলে ছাপে। লেবেলটি সরাসরি মিথ্যা।

**প্রমাণ:**
```bash
# MCP: কোনো জেলা ছাড়া দাবি
POST https://dordekha.pages.dev/mcp
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_claim","arguments":{"claim":"পেঁয়াজ ৬০ টাকা"}}}
```
উত্তর:
```
"district": {"bn":"জেলা-গড়","en":"national average"}
"actual": {"min":52,"max":60,"avg":56}
"url": "https://dordekha.pages.dev/price/onion-local-831"
```
আর D1-তে ঢাকার সেই পণ্যের সারি:
```
commodity 831, district 47, 2026-10-19 → retail_min 52, retail_max 60, retail_avg 56
```
**অর্থাৎ ৫২–৬০ ঢাকার দাম, কিন্তু ছাপা হয়েছে "জেলা-গড়"।** আসল জাতীয় গড়:
```
commodity 831, সব জেলা, 2026-10-19 → 47টি জেলা, min 43, max 58, avg 48.6
```
আর REST-এর জাতীয় উত্তর `/api/v1/answer?q=পেঁয়াজ` → `min 42, max 48.5, avg 44.5`।
**একই পণ্য, একই দিন — MCP বলছে ৫২–৬০ "জেলা-গড়", REST বলছে ৪২–৪৮.৫।**

**প্রভাব:** `verify_claim` হলো এই পণ্যের "ground truth" হাতিয়ার। এটি ভুল লেবেল দিলে একটি
অ্যাসিস্ট্যান্ট নিজেকে যাচাই করার বদলে ভুল সংখ্যা যাচাই করে নেবে।

**সমাধান:** জেলা না থাকলে হার্ড-কোড করা ঢাকা ব্যবহার না করে জাতীয় পথে যান:
```ts
// src/mcp.ts, verifyClaim
for (const c of candidates) {
  if (district) {
    const row = await resolveFact(env, c.id, district.id, null);
    if (row?.retail) checked.push({ commodity: c, row });
  } else {
    // জাতীয়: সব জেলার একই দিনের সারি থেকে মিডিয়ান
    const all = await latestForCommodityOrSnapshot(env, c.id, 200);
    const newest = all.map(r => r.priceDate).sort().pop();
    const sameDay = all.filter(r => r.priceDate === newest && r.retail?.avg != null);
    if (sameDay.length === 0) continue;
    const avg = sameDay.map(r => r.retail!.avg!).sort((a,b)=>a-b);
    const mid = avg[Math.floor((avg.length-1)/2)]!;
    checked.push({ commodity: c, row: {
      ...sameDay[0]!, priceDate: newest!,
      retail: { ...sameDay[0]!.retail!, min: Math.min(...avg), max: Math.max(...avg), avg: mid },
    }});
  }
}
```
এবং `where` লেবেলটি `"জেলা-গড়"` থেকে `"দেশজুড়ে (N জেলার মিডিয়ান)"` করুন, আর `structuredContent`
-এ `districts_reporting` যোগ করুন।

---

### [Important] ১০. যাচাই-হয়না ইউনিট-জোড়ার পাইকারি মান raw অবস্থায় খুচরার এককে প্রকাশ হয়

**ফাইল:** `src/normalize.ts:107-118`, `src/units.ts:186`, `src/units.ts:230-234`

**সমস্যা:** কোডের নিজের মন্তব্য বলে "যদি কোনো গুণক যাচাই করা যায় না, পাইকারি অংশ
**প্রকাশ করা হবে না**" — কিন্তু কোড তা করে না। `chooseDivisor` অজানা জোড়ায়
`{ divisor: 1, source: "unknown" }` ফেরত দেয়, আর `normalizeRow` তখনও পাইকারি তৈরি করে
(`toRetailUnit(raw, 1)` = কাঁচা বাল্ক মান) এবং তার `unitId` ধরে রাখে **`raw.unit_retail`** — অর্থাৎ
খুচরার একক। ফলে প্রতি ১০০ কেজির দাম প্রতি কেজি হিসেবে ছাপা হয়।

**প্রমাণ (কোড):**
```ts
// src/units.ts:186
return { divisor: 1, source: "unknown", note: `${key} → অজানা জোড়া, raw রাখা হয়েছে` };
// src/units.ts:230-234
return { divisor: primary, source: "unknown",
         note: `${key} → ÷${primary} (যাচাই করা যায়নি, মান আগ্রহের জন্য প্রকাশ করা হবে না)` };
// src/normalize.ts:114  ← unitId: raw.unit_retail  (খুচরার একক!)
```
`anomaly` সেট হয় (`unit-pair X>Y যাচাই করা যায়নি`), কিন্তু মানটা ছাপা হয়।
`src/render.ts:847`-এ পাইকারির সারিতে `esc(f.wholesale.unitBn)` বসে — খুচরার এককই।

**প্রভাব:** PLAN.md-এর নিজের মাপে ১৫টি সারি "যাচাই করা যায়নি"। ঐ ১৫টি সারিতে পাইকারির সংখ্যা
খুচরার এককে — ১০০ গুণ ভুল। ইনডেক্সড API-তে `divisor: 1, divisor_source: "unknown"` দেখা যায়,
কিন্তু `renderPriceFactJson`-এ (`src/render.ts:910-919`) `divisor`/`divisor_source` **নেইই** — তাই
একটি অ্যাসিস্ট্যান্ট কোথাও থেকেই বুঝবে না যে এই সংখ্যা অন্য এককে।

**সমাধান:** অজানা জোড়ায় পাইকারি প্রকাশ না করুন:
```ts
// src/normalize.ts
const wholesale: PriceTriple | null =
  rawWholesaleAvg === null || choice.source === "unknown"
    ? null
    : { ... };
```
আর `renderPriceFactJson`-এ `divisor` ও `divisor_source` যোগ করুন (নিচে #২৪ দেখুন)।

---

### [Important] ১১. carry-forward তখনই চিহ্নিত হয় যখন খুচরা **ও** পাইকারি দুটোই আগের দিনের সমান

**ফাইল:** `src/normalize.ts:135-142`

**সমস্যা:**
```ts
const carriedForward =
  ctx.previous != null &&
  retailAvg !== null && ctx.previous.retailAvg !== null &&
  retailAvg === ctx.previous.retailAvg &&
  wholesale?.avg != null && ctx.previous.wholesaleAvg !== null &&   // ← এটাই শর্ত
  Math.abs(wholesale.avg - ctx.previous.wholesaleAvg) < 0.01;
```
খুচরা আগের দিনের হুবহু সমান হলেও — পাইকারি বদলে গেলে বা পাইকারি না থাকলে — সারিটি
**"নতুন"** হিসেবে ছাপা হয়, যদিও খুচরার সংখ্যাটা আসলে আগের দিনেরই সরানো।

**প্রমাণ:** উপরের লক্ষণগুলোর সাথে মিলে যায়: ২০২৬-১০-১৯-এ D1-তে ৩,০০৩/৩,৬৬১ = ৮২% সারি `carried_forward=1`,
অথচ খুচরার অনুযায়ী হিসাব করলে শুধু ২০২৬-১০-১৮-এর সাথে মিলিয়ে দেখা যায়।
`src/normalize.ts:129-134`-এর মন্তব্যে বলা হয়েছে "the comparison has to be like-for-like" —
কিন্তু খুচরা ও পাইকারি দুটোকে একসাথে শর্ত করা হয়েছে, যা একটির উপর নির্ভরশীলতা তৈরি করে।

**প্রভাব:** (ক) "পূর্বের" ছাপ হার কম হয় → সাইটের প্রকাশিত carry-forward হার সত্যের চেয়ে কম;
(খ) মুভার্স-বোর্ড (`src/db.ts:1054`) ছাপ বাদ দেয় `cf === 1` — যেসব সারি আসলে carry-forward
কিন্তু চিহ্নিত নয়, সেগুলো মুভার্সে ঢুকে যেতে পারে।

**সমাধান:** দুটি আলাদা পতাকা রাখুন:
```ts
const retailSame = ctx.previous != null && retailAvg !== null &&
  ctx.previous.retailAvg !== null && retailAvg === ctx.previous.retailAvg;
const wholesaleSame = ctx.previous != null && wholesale?.avg != null &&
  ctx.previous.wholesaleAvg != null &&
  Math.abs(wholesale.avg - ctx.previous.wholesaleAvg) < 0.01;
const carriedForward = retailSame || wholesaleSame;   // যেকোনো একটা অগ্রসর হলেই
```
আর স্কিমায় `carried_forward` (যুক্ত) + `carried_forward_retail` + `carried_forward_wholesale`
আলাদা করে রাখুন, যাতে হার গণনা যায়।

---

### [Minor] ১০-ব. সাইটের "সবচেয়ে ব্যস্ত জেলা" ক্যাশ-পথে ও ডিবি-পথে আলাদা

**ফাইল:** `src/cache.ts:172-182` বনাম `src/db.ts:1283-1297`

**প্রমাণ:**
```
ক্যাশ (agg:current): "busiestDistrictId": 4, "busiestDistrictName": "রাঙ্গামাটি"
D1 (price_latest GROUP BY):  id=10 খাগড়াছড়ি (121), id=4 রাঙ্গামাটি (119)
```
ক্যাশ পথ শুধু **সর্বশেষ তারিখের** সারি গোনে, ডিবি পথ **সব** `price_latest` সারি গোনে।

**প্রভাব:** হোম পেজের "আজকের খাতা · <জেলা>" শিরোনাম ক্যাশ ও ডিবি পথে বদলাতে পারে।

**সমাধান:** দুটি পথে একই সংজ্ঞা ব্যবহার করুন — দুটোই `price_date = latest` দিয়ে গোনুন।

---

### [Minor] ২৯. জাতীয় (district 0) সারিগুলোর `retail_avg` আসলে সর্বনিম্ন দাম

**ফাইল:** `src/ingest.ts:681-700` (`backfillNational`)

```ts
const retail = Number(r.a_r_lowestPrice);      // ← সর্বনিম্ন দাম
const retailMax = Number(r.a_r_howestPrice);
...
retail: { min: retail, max: retailMax, avg: Number.isFinite(retail) ? retail : null, ... }
```
**প্রমাণ:**
```bash
npx wrangler d1 execute dordekha --remote --command \
 "SELECT COUNT(*) n, SUM(CASE WHEN retail_avg = retail_min THEN 1 ELSE 0 END) avg_eq_min FROM price_daily WHERE district_id = 0"
# → n=239, avg_eq_min=239   (২৩৯টির ২৩৯টিতেই avg == min)
npx wrangler d1 execute dordekha --remote --command \
 "SELECT COUNT(*) FROM price_latest WHERE district_id = 0"
# → 239
```
**প্রভাব:** এই ২৩৯টি সারি আজ প্রকাশিত হয় না — `latestForCommodity`, `commodityMedians`,
`busiestDistrict`, `writeSnapshot`, `ledgerRows` সব `district_id > 0` ফিল্টার করে।
কিন্তু দুটি পথ ফিল্টার করে না:
- `commodityCoverage` (`src/db.ts:704`) — `WHERE commodity_id IN (...)` মাত্র, তাই প্রতিটি
  পণ্যের কভারেজে +১ গণনা হয় (টাই-ব্রেকারের সংকেতে সামান্য বিকৃতি)।
- `carriedShare` (`src/db.ts:1255`) — `WHERE price_date = (SELECT MAX(price_date) FROM price_daily)`
  মাত্র, জাতীয় সারিও গণনা করে। **তবে এই ফাংশনটি মৃত কোড** (কোথাও import করা হয়নি)।

**সমাধান:** জাতীয় সারির `avg` বাদ দিন (মাথায় থাকুক শুধু `min`/`max`), অথবা
`anomaly: "জাতীয় স্ক্রল: avg = সর্বনিম্ন দাম"` দিন। `commodityCoverage`-এ `district_id > 0`
যোগ করুন। `carriedShare`-কে মৃত কোড হিসেবে মুছুন।

---

## ২. ফ্রি টায়ারের কোটা

### [Critical] ৩. KV লেখার বাজেট প্রতি-মিনিটের ক্রনে ৮.৬ গুণ ছাড়ানো; ত্রুটি নিঃশব্দে ছাড়া হচ্ছে

**ফাইল:** `src/ingest.ts:169` (`budgetAdd`), `src/ingest.ts:486` (`setHistoryDate`),
`src/cache.ts:101-107` (`kvSet`), `src/cache.ts:474-497` (`setHistoryDate`)

**সমস্যা:** প্রতিটি ক্রন টিকে ইনজেস্ট **৬টি KV লেখা** করে:

| কোথায় | লেখা | সংখ্যা |
|---|---|---|
| `src/ingest.ts:169` | `ingest:budget:<দিন>` | ১ |
| `src/cache.ts:486` | `history:date:<তারিখ>:<জেলা>` (৪টি ব্যাচ) | ৪ |
| `src/cache.ts:496` | `history:index` (ম্যানিফেস্ট) | ১ |
| | **মোট** | **৬** |

৬ × ১,৪৪০ টিক/দিন = **৮,৬৪০ KV লেখা/দিন**। Cloudflare-এর ফ্রি টায়ারে **১,০০০ লেখা/দিন** — **৮.৬ গুণ** বেশি।

আর `src/cache.ts:101-107`-এর `kvSet` প্রতিটি ত্রুটি **নিঃশব্দে** ছেড়ে দেয়:
```ts
async function kvSet(env: Env, key: string, value: unknown, ttl: number): Promise<void> {
  try { await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }); }
  catch { /* a cache write failure must never break a request */ }
}
```
ফলে বাজেট ভাঙলে ইনজেস্ট চুপচাপ চলতে থাকে, কিন্তু **ইতিহাসের শার্ড ও ম্যানিফেস্ট আর লেখা হয় না**।

**প্রমাণ (পর্যবেক্ষণ):** যে তারিখ স্ক্যান করা হয়েছে, তার কিছু শার্ড নেই:
```bash
npx wrangler kv key list --namespace-id 0c856163da4147bb9ff14a1d01f2962f --remote --prefix "history:date:2026-10-17"
# → []
npx wrangler kv key list --namespace-id 0c856163da4147bb9ff14a1d01f2962f --remote --prefix "history:date:2026-10-18"
# → 61টি কী
```
অথচ `ingest_run` দেখায় ২০২৬-১০-১৭ স্ক্যান হয়েছে (`id=12`, `id=18` scope='district') এবং D1-তে
ওই তারিখে ৩,৭৫০ সারি আছে। ম্যানিফেস্টেও ২০২৬-১০-১৭-এর কোনো এন্ট্রি নেই (উপরে #৫-এর টেবিল)।

**যা পরিমাপ করা হয়েছে বনাম যা অনুমান:**

| দাবি | মাত্রা |
|---|---|
| ইনজেস্ট প্রতি টিকে ৬টি KV লেখা করে, মোট ৮,৬৪০/দিন | **মাপা** (কোড) |
| ফ্রি টায়ারের মেয়াদ ১,০০০ লেখা/দিন | **মাপা** (Cloudflare-এর নীতি) |
| স্ক্যান করা তারিখের শার্ড অনুপস্থিত (১০-১৭: ০/৬৪) | **মাপা** (KV) |
| জুনের তারিখগুলো বেশিরভাগ সম্পূর্ণ (০৬-২৪: ৬১, ০৬-২৫: ৬০, ০৬-২৮: ৫৮) | **মাপা** (KV) |
| ব্যর্থতা ছড়ানো — পরিষ্কার কাটওয়ালা নয় | **মাপা** |
| "লিমিট অতিক্রমই কারণ" | **অনুমান** — GraphQL-এ KV-এর স্ট্যাটাস/অপারেশন-টাইপ ভাঙ্গা, সরাসরি 429-ট্রেস দেখা যায়নি |

অর্থাৎ দুটি সম্ভাবনা আছে — (ক) লিমিট অতিক্রম, অথবা (খ) নির্দিষ্ট কোনো লেখা ব্যর্থ হচ্ছে।
**দুটোর ক্ষেত্রেই প্রথম কাজ একই: লেখার ত্রুটি লগ করা।** এটা না করে পরের ধাপে যাওয়া যাবে না।

**প্রভাব:** (ক) সাইটের প্রকাশিত ডেটাসেট-আকার ভুল (#৫); (খ) D1 রিড ব্যাকআপ ভাঙে — `price_latest`
আর ইতিহাসের ক্যাশ-কপি থাকে না, তাই রিড কোটা শেষ হলে সাইট ৫০০ দেবে; (গ) `ingest:budget`
কাউন্টার আংশিক না লেখা হলে D1 রাইট বাজেট গার্ড ভুল হয়।

> **সতর্কতা (প্রমাণের মাত্রা):** *উপরের হিসাবটি মাপা* (কোডের গণনা) এবং *শার্ড অনুপস্থিতি
> পর্যবেক্ষণ করা*। কিন্তু "লেখাগুলো ফেলে দেওয়া হচ্ছে লিমিট অতিক্রমের কারণে" — এই **কার্যকারণটি
> অনুমান**; Cloudflare-এর GraphQL-এ KV-এর অপারেশন-টাইপ/স্ট্যাটাস ভাঙ্গা থাকায় সরাসরি
> 429-ট্রেস দেখা যায়নি। যাচাই করার সহজ উপায়: `kvSet`-এর `catch` ব্লকে একটি
> `console.error` বসালে পরের ক্রন-টিকেই লগে পাওয়া যাবে (সমাধানের অংশ)।

**সমাধান (তিনটি, একসাথে):**
1. **লেখার হিসাব কমান:** বাজেট কাউন্টারটি প্রতি টিকে নয়, **প্রতি ৫ টিকে** (বা ঘণ্টায়) লিখুন;
   `history:index` ম্যানিফেস্টটি **প্রতিটি ব্যাচে নয়, প্রতি ১৬ ব্যাচে** (অর্থাৎ একটি তারিখ শেষে)
   লিখুন; শার্ডগুলো একটি ব্যাচে ৪টি — এটাই প্রয়োজন, কিন্তু **প্রতিটি টিকে ৪টি** লেখা ৪,০০০/দিন।
   বিকল্প: `history:date:<তারিখ>` একটি কীতে ৬৪ জেলার সব সারি রাখুন (≈৫৫ KB, ২৫ MB সীমার অনেক কম) —
   তাহলে **১ টিক = ২ লেখা** → ২,৮৮০/দিন, আর ১২ দিনের TTL-এ কী-সংখ্যা মাত্র ১২-১৫।
2. **ত্রুটি লগ করুন:** নিঃশব্দে ছাড়বেন না:
```ts
async function kvSet(env: Env, key: string, value: unknown, ttl: number): Promise<void> {
  try { await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }); }
  catch (err) {
    console.error("kv write failed", key, err instanceof Error ? err.message : String(err));
    // একটি কাউন্টার বাড়ান, যাতে স্বাস্থ্য-পর্যবেক্ষণে দেখা যায়
    throw err;   // ইতিহাসের ক্ষেত্রে চুপচাপ লেখা বন্ধ হওয়া উচিত নয়
  }
}
```
3. **বাজেটের হিসাব D1-তে রাখুন:** KV-র লেখার লিমিটই ফুরিয়ে যাচ্ছে — বাজেট কাউন্টারটি
   `ingest_job`-এর JSON-এর ভেতরে রাখলে আলাদা KV লেখা লাগবে না।

---

### [Critical] ৪. D1 রিড কোটা ২১ অক্টোবরে ভেঙেছে (৭.৩M > ৫M), ২২ অক্টোবরেও ঝুঁকিতে

**ফাইল:** `src/index.ts:186` (`getAggregates`), `src/cache.ts:25` (`AGGREGATE_TTL = 6h`),
`src/ingest.ts:639-641` (`refreshAggregates` শুধু কাজ শেষে), `src/db.ts:782-790` (`historyRange`)

**সমস্যা (ক) অ্যাগ্রিগেটের ক্যাশ সারাক্ষণ টিকে থাকে না।** `getAggregates` প্রতিটি অনুরোধের
একেবারে উপরে ডাকা হয় (`src/index.ts:186`)। `agg:current` মেয়াদ ৬ ঘণ্টা, কিন্তু
`refreshAggregates` **শুধু কাজ শেষে** ডাকা হয় (`src/ingest.ts:639`)। ব্যাকফিল একটি কাজ
প্রায় ৩২ ঘণ্টা চলে (১২০ তারিখ × ১৬ টিক) — তাই ৬ ঘণ্টা পর ক্যাশ ফুরিয়ে যায়, এবং প্রতিটি
অনুরোধে পুরো টেবিল স্ক্যান হয়।

**প্রমাণ (Cloudflare GraphQL):**
```
d1AnalyticsAdaptiveGroups, sum { rowsRead rowsWritten }
2026-10-22  rowsRead=1,166,263  rowsWritten=135,044   (০৫:২০ UTC পর্যন্ত)
2026-10-21  rowsRead=7,326,427  rowsWritten=381,389   ← ৫,০০০,০০০ সীমা ছাড়িয়েছে
2026-10-20  rowsRead=  575,087  rowsWritten=350,332
```
**২১ অক্টোবরে ৭,৩২৬,৪২৭ সারি পড়া হয়েছে — সীমা ৫,০০০,০০০।** ২২ অক্টোবরে মাত্র ৫ ঘণ্টায় ১,১৬৬,২৬৩
(২৪ ঘণ্টায় ≈ ৫.৩M) — অর্থাৎ আবার সীমার ওপরে।

**এই পড়াটা কোথা থেকে এসেছে (আনুমানিক ভাঙ):** ইনজেস্টের প্রতিটি টিক নিজেই ~৮০০–১,০০০ সারি
পড়ে (`previousValuesForDistricts` + `refreshLatestFor`-এর SELECT + `writeJob` +
`recordIngestRun`) → ১,৪৪০ টিকে ≈ ১.২–১.৪M সারি/দিন, আর `historyRange` দিনে একবার আরও ২৮,১৪৩।
বাকি ≈৫–৬M এসেছে ভিজিটর ও ব্যাখ্যাত্মক পুনরায়-চেষ্টা থেকে। **এখানে একটি আত্ম-পুনরায়-বৃদ্ধির
লুপ আছে:** যখন কোটা ফুরিয়ে যায়, প্রতিটি ট্রাফিক-অনুরোধ আবার ৩৬,৭৮১-সারির অ্যাগ্রিগেট
স্ক্যান চালায়, ফলে ব্যর্থতা নিজেই কোটা আরও দ্রুত শেষ করে।

**প্রমাণ (প্রতি অনুরোধে কত সারি):** অ্যাগ্রিগেটের DB পথের প্রতিটি কোয়েরি মাপা হয়েছে —
`npx wrangler d1 execute ...`-এর `meta.rows_read`:
```
A1 span/count over price_daily        rows_read=28143
A2 busiest district GROUP BY price_latest rows_read= 4472
A3 latest-date counts                 rows_read= 3661
A4 upazila count                      rows_read=  505
                                  মোট = 36,781 সারি প্রতি অনুরোধ
```
হোম পেজে আরও যোগ হয় (`movers`):
```
M1 SELECT DISTINCT price_date ... LIMIT 2   rows_read=7854
M2 movers self-join                        rows_read=6060
```
→ **হোম পেজের একটি ভিউ ≈ ৫০,৯০০ সারি।** ৫,০০০,০০০ ÷ ৫০,৯০০ ≈ **৯৮ ভিউ/দিন** — তারপর সাইট ডিবি-হীন হয়ে পড়ে।

**সমাধান:**
1. `agg:current` ৬ ঘণ্টা পর মুছে যাওয়ার আগেই রিফ্রেশ হওয়ার ব্যবস্থা করুন — `refreshAggregates`
   কাজ শেষে হওয়ার জায়গায় **প্রতি তারিখের স্কোয়াপ শেষে** (`src/ingest.ts:611`-এর কাছে) ডাকুন।
2. `getAggregates`-কে `src/index.ts:186`-এ প্রতিটি রাউটে না, **শুধু যেখানে দরকার** সেখানে ডাকুন
   (যেমন `/health`, `/llms.txt`, `/dataset`, হোম পেজ) — `/robots.txt`, `/sitemap.xml`,
   `/api/v1/districts`, ৪০৪ — এদের জন্য অ্যাগ্রিগেট লাগে না।
3. `computeAggregatesFromDb`-এর চারটি কোয়েরি একটিতে মিলিয়ে দিন (`COUNT(*)` ও `MIN/MAX` একটি পাসে):
```sql
SELECT COUNT(*) AS rows, MIN(price_date) AS first, MAX(price_date) AS last,
       COUNT(DISTINCT price_date) AS days,
       SUM(CASE WHEN price_date = (SELECT MAX(price_date) FROM price_daily) THEN 1 ELSE 0 END) AS last_rows,
       SUM(CASE WHEN price_date = (SELECT MAX(price_date) FROM price_daily) AND carried_forward=1 THEN 1 ELSE 0 END) AS last_carried,
       COUNT(DISTINCT CASE WHEN price_date = (SELECT MAX(price_date) FROM price_daily) THEN commodity_id END) AS last_commodities,
       COUNT(DISTINCT CASE WHEN price_date = (SELECT MAX(price_date) FROM price_daily) THEN district_id END) AS last_districts
  FROM price_daily WHERE district_id > 0
```
(এতে স্ক্যান ২৮,১৪৩ + ৪,৪৭২ + ৩,৬৬১ + ৫০৫ ≈ **৩৬,৭৮১ → ২৮,১৪৩** হয়, অর্থাৎ −২২%))

---

### [Important] ১৮. D1 রাইটও ফ্রি-টায়ার সীমার ৩.৮ গুণ

**ফাইল:** `src/ingest.ts:154` (`DAILY_ROW_BUDGET = 80_000`), `src/ingest.ts:556` (`budgetAdd(env, written * 2)`)

**সমস্যা:** বাজেট গার্ড ৮০,০০০ গণনা করে, কিন্তু প্রকৃত লেখা ৩৮১,৩৮৯ সারি/দিন (২১ অক্টোবর) —
যা ফ্রি-টায়ার সীমার (১,০০,০০০ সারি/দিন) **৩.৮ গুণ**।

**প্রমাণ:** GraphQL → `2026-10-21 rowsWritten=381,389`, `2026-10-20 rowsWritten=350,332`।

**কারণ:** বাজেটের হিসাব অসম্পূর্ণ —
- `budgetAdd(env, written * 2)` কেবল `price_daily` ও `price_latest` ধরে, কিন্তু `refreshLatestFor`-এর
  `INSERT ... SELECT` আরও সারি লেখে; `backfillNational` (`src/ingest.ts:717`), `recordIngestRun`,
  `writeJob` এবং `usage_event` লেখাগুলো গণনার বাইরে।
- `written` হলো `res.meta.changes` — একটি UPDATE হলেও ১ গণ্য, কিন্তু D1-র "rows written"-এ
  প্রতিটি UPDATE-ও লেখা হিসেবে গোনা হয়।

**প্রভাব:** গার্ড ৮০,০০০-এ থামার বদলে প্রকৃত লেখা ৩৮০,০০০ হচ্ছে — ফ্রি টায়ারের বাইরে।

**সমাধান:** বাজেট কাউন্টারটি প্রতিটি টিকে **আসল ব্যযত্প্রহের** হিসাব রাখুন, এবং
`ingest_run`-এর `rows_written` দিয়ে যাচাই করুন:
```ts
const written = await upsertPrices(env.DB, records);
const latestWritten = await refreshLatestFor(env.DB, current, districts);
await budgetAdd(env, written + latestWritten + 2);   // + ingest_run + ingest_job
```
আর `DAILY_ROW_BUDGET` ৮০,০০০ → **৪০,০০০** করুন, যাতে বাস্তব লেখা ১০০,০০০-এর নিচে থাকে।

---

### [Important] ১৭. `ingest_run` টেবিলে প্রতিটি তারিখের সারি-সংখ্যা ভুল লেখা হচ্ছে

**ফাইল:** `src/ingest.ts:578-591`

**সমস্যা:** তারিখ শেষ হওয়ার সময় `recordIngestRun` ডাকা হয়, কিন্তু পাঠানো হয় **শেষ ব্যাচের** সংখ্যা,
পুরো তারিখের নয়:
```ts
rowsWritten: records.length,     // ← শেষ ব্যাচের ৪ জেলার সারি
districtsOk: ok,                 // ← ৪, পুরো তারিখের ৬৪ নয়
districtsMissing: missing,
```
`job.rowsWritten` ও `job.districtsOk` (সমগ্র) কাজে লাগে না — ওগুলো শুধু লগে থাকে।

**প্রমাণ:**
```
ingest_run id=19: price_date=2026-10-19, rows_written=324, districts_ok=4, status=ok
আসল (D1): price_daily 2026-10-19 → 3,661 সারি, 56টি জেলা
```

**প্রভাব:** `/internal/health`-এর `lastRun` সংখ্যা সবসময় ভুল দেখায় (৩২৪ বনাম ৩,৬৬১)।
কোনো তারিখ কতটা ইনজেস্ট হয়েছে তা যাচাই করা যায় না — `collectedDates` এই টেবিলের উপর নির্ভর করে,
তাই ব্যাকফিলের "এই তারিখ আমার কাছে আছে" সিদ্ধান্তও ভিত্তিহীন।

**সমাধান:**
```ts
await recordIngestRun(env.DB, {
  priceDate: current,
  scope: job.kind === "backfill" ? "backfill" : "district",
  startedAt,
  finishedAt: new Date().toISOString(),
  rowsWritten: job.rowsWrittenForDate,   // তারিখ-স্তরের সমগ্র হিসাব রাখুন
  districtsOk: job.districtsOkForDate,
  districtsMissing: job.districtsMissingForDate,
  status: missing === 0 ? "ok" : "partial",
});
```
(`job`-এ প্রতি-তারিখ লেডার যোগ করুন, তারিখ শেষে রিসেট করুন।)

---

### [Minor] ১৬-ব. প্রতি-মিনিটের ক্রনের প্রতিটি টিকে কত সারি পড়া হচ্ছে

| কোয়েরি | ফাইল | সারি/টিক |
|---|---|---|
| `previousValuesForDistricts` | `src/db.ts:823` | ~৩৮০ (সূচক আছে) |
| `refreshLatestFor`-এর SELECT | `src/db.ts:668` | ~৩৮০ |
| `upsertPrices` | `src/db.ts:569` | লেখা |
| `readJob` / `writeJob` | `src/db.ts:944,955` | ১ + ১ |
| `recordIngestRun` | `src/db.ts:966` | ১ (লেখা) |
| `historyRange` (দিনে একবার) | `src/db.ts:782` | **২৮,১৪৩** |
| `movers` (হোম পেজ) | `src/db.ts:1211,1217` | **১৩,৯১৪** |

`historyRange` দিনে একবার ২৮,১৪৩ সারি পড়ে — দৈনিক বাজেটের ০.৫৭%।
`movers`-এর দুটি কোয়েরি ১৩,৯১৪ — এটি ঘরে থাকলে প্রতিটি হোম-পেজ ভিউ ১৩,৯১৪ সারি খাচ্ছে (নিচে #২০)।

---

## ৩. উপলভ্যতা ও সঠিকতা

### [Important] ১৮-ব. ক্যাশ-প্রথম পথ ও D1-পথ একই প্রশ্নের আলাদা উত্তর দেয়

**ফাইল:** `src/cache.ts:154-199` বনাম `src/cache.ts:207-279`; `src/db.ts:1283-1297` বনাম `src/cache.ts:172-182`

**প্রমাণ:** "সবচেয়ে ব্যস্ত জেলা" — ক্যাশ: রাঙ্গামাটি (id 4) · D1: খাগড়াছড়ি (id 10, ১২১ সারি)।
"দিন-সংখ্যা" — ক্যাশ: ১০ · D1: ১১। "সারি" — ক্যাশ: ২৪,১৬৩ · D1: ২৮,৩৮২।

**সমস্যা:** দুটি পথই সঠিক হতে পারে, কিন্তু **একই প্রশ্নে দুটি ভিন্ন উত্তর** — যা ঠিক একই
"একই সত্যের দুই সংখ্যা" শ্রেণি, যা PLAN.md-তে "✅ সারানো" লেখা।

**সমাধান:** অ্যাগ্রিগেটের **একটিই** সংজ্ঞা ঠিক করুন (D1-বাস্তবতা) এবং D1 পথকেই
ব্যবহার করুন, ক্যাশে শুধু **ফলাফল** ক্যাশ করুন — সংজ্ঞা নয়:
```ts
// ক্যাচ-পথে ফলাফল ক্যাশ করা যাক, কিন্তু সংজ্ঞা এক জায়গায় থাকুক
// src/db.ts — একটিমাত্র সংজ্ঞা
export const AGGREGATE_SQL = `...`;   // উপরের মিলানো কোয়েরি
```

### [Important] ইনজেস্ট আংশিক ব্যর্থ হলে `price_latest` জেলা-ভিত্তিক তারিখে বিভক্ত

**ফাইল:** `src/db.ts:653-689` (`refreshLatestFor`)

**প্রমাণ:** `price_latest`-এ আটটি তারিখ (উপরের টেবিল)। ৬৪ জেলার ৫৬ জেলার ১০-১৯ তারিখের
সারি আছে; ২ জেলা ০৬-২৪ তারিখে আটকে আছে।

**প্রভাব:** `price_latest` "সর্বশেষ দাম" টেবিল হওয়া সত্ত্বেও প্রতি কী-এর তারিখ আলাদা —
যার ফলে #৭ ও #৮-এর মিশ্র-তারিখের সমস্যা। `refreshLatestFor`-এর "শুধু সামনে এগো" নিয়মটি
(`WHERE excluded.price_date > price_latest.price_date`) এই বিভক্তি ঠেকাতে পারে না — কারণ
যে জেলা ওই দিনে জমা দেয়নি, তার জন্য সঠিক তারিখই পুরনো।

**সমাধান:** এটি আসলে উপরের ডেটা-মডেলের সত্য — কিন্তু **প্রকাশনায়** এটি লুকাতে হবে।
`price_latest` পড়ে এমন কোথাও (যেখানে একটি তারিখ দাবি করা হয়) তারিখ-ভিত্তিক ফিল্টার যোগ করুন
(যেমন #৭-এর সমাধান)।

### [Minor] ২০. `moversOrSnapshot` ইতিহাসের লিগ্যেসি একক-কী পড়ে, যা ইনজেস্ট আর আপডেট করে না

**ফাইল:** `src/db.ts:1034-1082`

**সমস্যা:** কমেন্ট বলে "ক্যাশ থেকে গণনা — ০ D1 সারি", কিন্তু যে ক্যাশ পড়া হচ্ছে তা
`history:snapshot` — **লিগ্যেসি একক-কী**, যা শুধু `/internal/snapshot-upload` দিয়ে ম্যানুয়ালি
তৈরি হয় (২১ অক্টোবরে আপলোড করা, ১১,৩৬৪ সারি, ৩টি তারিখ)। ইনজেস্ট শার্ডযুক্ত ক্যাশ ব্যবহার করে না।

**প্রমাণ:**
```bash
npx wrangler kv key get --namespace-id 0c856163da4147bb9ff14a1d01f2962f --remote "history:snapshot"
# → 11364 rows, dates: 2026-10-17, 2026-10-18, 2026-10-19
npx wrangler kv key list --namespace-id 0c856163da4147bb9ff14a1d01f2962f --remote --prefix "history:snapshot"
# expiration 2026-10-23 12:42
```

**প্রভাব:** ২৩ অক্টোবর দুপুরে এই কী মরে যাবে → `moversOrSnapshot` ডিবি-পথে পড়বে →
**প্রতিটি হোম-পেজ ভিউয়ে +১৩,৯১৪ সারি** (উপরে মাপা)। হোম পেজের দৈনিক ভিউ ৫০ → ৯৮-এ নামবে না।

**সমাধান:** ইতিহাসের শার্ডযুক্ত ক্যাশ ব্যবহার করুন — `getHistoryForDate`-এর মতো:
```ts
const hist = await getHistorySnapshot(env);   // ← এটা বদলে
const dates = [...new Set(hist.rows.map(r => r.t))].sort().reverse();
```
→ এর বদলে:
```ts
const dates = (await getHistoryDates(env)).sort().reverse();   // ম্যানিফেস্ট থেকে
if (dates.length >= 2) {
  const [newer, older] = dates;
  const newerRows = (await getHistoryForDate(env, newer)).filter(r => r.d !== 0);
  const olderByKey = new Map((await getHistoryForDate(env, older)).map(r => [`${r.d}:${r.c}`, r]));
  /* ... একই যুক্তি ... */
}
```
**এতে মুভার্স-বোর্ড ১২ দিনের ইতিহাস দেখাবে, D1 সারি পড়বে না, আর লিগ্যেসি কীয় দরকার হবে না।**

### [Minor] ৩০. দৈনিক ইনজেস্টের রিপোর্ট-দিন শনাক্তকরণ ঢাকার উপর নির্ভরশীল

**ফাইল:** `src/ingest.ts:136-145` (`targetDates`)

```ts
const rows = await fetchDailyPrices({ priceDate: ymd, districtId: 47 }, { baseUrl: env.SOURCE_API });
if (rows.length > 0) found.push(ymd);
```
**সমস্যা:** রিপোর্ট-দিন খুঁজতে শুধু জেলা ৪৭ (ঢাকা) প্রোব করা হয়। ঢাকায় কোনো দিনে জমা না দিলে
কিন্তু অন্য কোনো জেলায় দিলে, **সেই পুরো তারিখটি ইনজেস্ট থেকে বাদ পড়বে** — ৬৩ জেলার
তথ্য একসাথে।

**প্রমাণ:** লাইভ উৎসে ২০২৬-১০-২০/২১/২২-এ ঢাকার জন্য `success=false` — উপরের সাইট ঠিকই
২০২৬-১০-১৯ পর্যন্ত আছে, কিন্তু এই ঝুঁকি বাস্তব (উৎসে ঢাকা বাদ পড়লে পুরো দিন বাদ যায়)।

**সমাধান:** দুটি বা তিনটি ভিন্ন জেলা প্রোব করুন (যেমন ৪৭, ১০, ৪৭) — খরচ প্রায় একই:
```ts
const probes = [47, 10, 4];
for (const d of probes) {
  const rows = await fetchDailyPrices({ priceDate: ymd, districtId: d }, { baseUrl: env.SOURCE_API });
  if (rows.length > 0) { found.push(ymd); break; }
}
```

### [Minor] ২১. ইনজেস্ট-রানে আটকে থাকা `running` সারি

**ফাইল:** `src/ingest.ts:479-484`, `src/db.ts:966-997`

**প্রমাণ:** `ingest_run` id = 4, 9, 11, 16, 17 — সব `status='running'`, `finished_at=NULL`,
`rows_written=0`। ২১ ও ২২ অক্টোবরের দুটি সারি এখনও খোলা।

**প্রভাব:** `ingestHealth`-এ `lastRun` হিসাবে `ORDER BY id DESC LIMIT 1` — যেটি একটি **'running'**
সারি হলে ০ সারি দেখায়, যদিও আসলে কাজ হয়েছে। মনিটরিং ভুল সংকেত দেয়।

**সমাধান:** পুরনো `running` সারিগুলো বন্ধ করুন, বা `lastRun`-এর কোয়েরিতে
`ORDER BY (status='running') ASC, id DESC` দিন।

### [Minor] ২৬. অ-কী অনুরোধে কোনো রেট-লিমিট নেই

**ফাইল:** `src/keys.ts:340-341`

```ts
const key = keyFromRequest(request);
if (!key) return { ok: true, status: 200, licence: null };
```
**প্রমাণ (live):** `curl -s -o /dev/null -w "%{http_code}" "https://dordekha.pages.dev/api/v1/latest?district=47"` → `200`

**প্রভাব:** বার্স্ট গার্ড কেবল কীওয়ালা ক্লায়েন্টের জন্য। যে কেউ কী ছাড়া `/api/v1/latest`
ক্রল করতে পারে, আর প্রতিটি ভিউ ~৩৭,০০০ D1 সারি পড়ায় — **৫M রিড বাজেট ১৩৫ ভিউতেই শেষ।**
(নীতিটি বোঝা যায় — উদ্মুক্ত ডেটা — কিন্তু ডিবি-কোটার বাস্তবতার কথা মাথায় রাখা দরকার।)

**সমাধান:** Cloudflare-এর নিজস্ব Rate Limiting ব্যবহার করুন (ফ্রি প্ল্যানে ১টি rule) অথবা
IP-ভিত্তিক KV কাউন্টার (কিন্তু সেটা KV লেখার বাজেটে গিয়ে যাবে — #৩-এ সমাধান হওয়ার পর)।

---

### [Important] ২৭. D1 অপঠনযোগ্য হলে তারিখ-নির্দিষ্ট ফ্যাক্ট পাতা ৪০৪ দেয়, অথচ ক্যাশে সেই তারিখের ডেটা আছে

**ফাইল:** `src/db.ts:390-405` (`priceForDateOrSnapshot`)

**সমস্যা:** ফলব্যাক পথে শুধু **লিগ্যেসি সিঙ্গেল-কী** ইতিহাস দেখা হয়, **শার্ডযুক্ত ম্যানিফেস্ট** ইতিহাস
(`getHistoryForDate`) দেখা হয় না:
```ts
export async function priceForDateOrSnapshot(env, commodityId, districtId, date) {
  try { return await priceForDate(env.DB, commodityId, districtId, date); }
  catch (err) {
    const hist = await getHistorySnapshot(env);   // ← লিগ্যেসি কী: history:snapshot
    const r = hist.rows.find(x => x.c === commodityId && x.d === districtId && x.t === date);
    ...
  }
}
```
`history:snapshot` কী-টি ২১ অক্টোবরে **ম্যানুয়ালি** আপলোড করা (১১,৩৬৪ সারি, ৩টি তারিখ) এবং
**২৩ অক্টোবর ১২:৪২-এ মরে যাবে**। ইনজেস্ট যে শার্ডযুক্ত ক্যাশ (৯টি তারিখ) বজায় রাখে, সেটা
এই পথে কখনও ব্যবহার হয় না।

**প্রভাব:** D1 রিড কোটা ফুরিয়ে গেলে — **যে পার্মালিংকই এই পণ্যের একমাত্র সম্পদ** —
`/price/<পণ্য>/<জেলা>/<তারিখ>` ৪০৪ দেয়, অথচ ক্যাশে সেই তারিখের সারি আছে। হোম পেজ ক্যাশ থেকে
চলবে, কিন্তু উদ্ধৃতিযোগ্য পাতাটি ভেঙে যাবে। PLAN.md-এর "সাইট D1-হীন চলে" দাবিটি
**শুধু হোম পেজের জন্য সত্য**, পার্মালিংকের জন্য নয়।

**সমাধান:**
```ts
export async function priceForDateOrSnapshot(env, commodityId, districtId, date) {
  try { return await priceForDate(env.DB, commodityId, districtId, date); }
  catch {
    // ১. শার্ডযুক্ত ইতিহাস (ইনজেস্ট যা বজায় রাখে)
    const shards = await getHistoryForDate(env, date);
    const hit = shards.find(x => x.c === commodityId && x.d === districtId);
    if (hit) return historyRowToOut(hit);
    // ২. তারপর লিগ্যেসি
    const hist = await getHistorySnapshot(env);
    if (!hist) return null;
    const r = hist.rows.find(x => x.c === commodityId && x.d === districtId && x.t === date);
    return r ? historyRowToOut(r) : null;
  }
}
```

### [Important] ২৮. `recordUsage`-এর ফলব্যাক পাথ মাস ও উইন্ডো রোলওভার করে না

**ফাইল:** `src/keys.ts:297-312`

**সমস্যা:** প্রধান `UPDATE` ব্যর্থ হলে ফলব্যাকটি শুধু কাউন্টার বাড়ায়:
```ts
env.DB.prepare(`UPDATE license SET calls_used = calls_used + 1 WHERE id = ?`).bind(licence.id),
```
`period`, `burst_count`, `burst_window` সেট হয় না। আর `checkAccess` (`src/keys.ts:174`) পড়ে
`lic.period === currentPeriod(now) ? lic.callsUsed : 0` — `period` NULL হলে `used` **সবসময় ০**,
আর `burstWindow` NULL হলে বার্স্ট গার্ড **কখনও চালু হয় না**।

**প্রভাব:** যে ডেটাবেজে `license.period`/`burst_count`/`burst_window` কলাম নেই (মাইগ্রেশন
০০০৫ প্রয়োগ না হলে, বা `ensureSchema` ব্যর্থ হলে), সেখানে **মাসিক কোটা ও বার্স্ট গার্ড
সম্পূর্ণ অকার্যকর** — কোটা কখনও রিসেট হয় না, তবে কখনও আটকেও থাকে না।
(`src/maintenance.ts:164-180` কলামগুলো প্রতিদিন যোগ করে, তাই আজ প্রোডাকশনে ঠিক আছে —
এটি **অদৃশ্য ঝুঁকি**, কিন্তু ফলব্যাক পথের অর্থহীনতা সত্য।)

**সমাধান:** ফলব্যাকেও একই CASE-ভিত্তিক রোলওভার লজিক রাখুন (কলাম না থাকলে অবশ্যই ব্যর্থ হবে,
তাই ফলব্যাক উপযোগী নয়):
```ts
// ফলব্যাক ব্লকে:
env.DB.prepare(
  `UPDATE license SET calls_used = calls_used + 1 WHERE id = ?`
).bind(licence.id)
// এর বদলে চাপ দিন: কলাম না থাকলে কোটা আটকে না — কেবল কাউন্টার বাড়ে না।
// সবচেয়ে নিরাপদ: ফলব্যাক বাদ দিন, আর ensureSchema-কে ব্যর্থ হলে কোটা পথ 503 দিন।
```

---

### [Important] ৪০. Pages ফ্রন্ট মূল provenance ও CORS হেডার ছেঁড়ে দেয়

**ফাইল:** `pages/_worker.js:44-55` (`FORWARD_RESPONSE_HEADERS`)

**সমস্যা:** Worker যে হেডারগুলো পাঠায়, ফ্রন্টের allow-list-এ যা নেই তা ফেলে দেয়।
প্রমাণ (live, দুই হোস্টে একই পেজ):

| হেডার | Worker (origin) | Pages (front) |
|---|---|---|
| `MCP-Protocol-Version` | `2026-07-28` | **null** |
| `Access-Control-Allow-Origin` | `*` | **null** |
| `X-Content-Source-Date` | `2026-10-19` | **null** |
| `X-Content-Source-Id` | `moa-dam` | **null** |
| `X-Dordekha-Front` | null | `pages` |

```bash
curl -sI https://dordekha.shouroveh9.workers.dev/mcp -X POST -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
# → mcp-protocol-version: 2026-07-28 · access-control-allow-origin: *
curl -sI https://dordekha.pages.dev/mcp -X POST -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
# → দুটোই নেই
```

**প্রভাব:** (ক) **MCP-এর CORS হেডার canonical ঠিকানায় পৌঁছায় না** — আর canonical ঠিকানাটিই
`SITE_ORIGIN` (`https://dordekha.pages.dev`)। ব্রাউজার-ভিত্তিক MCP ক্লায়েন্ট এই ঠিকানায়
যুক্ত হতে পারবে না (preflight ইতিমধ্যে 405 — #১৫); (খ) **ডেটার তারিখের হেডার
(`X-Content-Source-Date`) ক্লায়েন্ট পায় না** — অ্যাসিস্ট্যান্ট প্রতিটি উত্তরে তারিখ
যাচাই করতে পারে না; (গ) MCP প্রটোকল-সংস্করণের হেডারও পৌঁছায় না, তাই স্পেক-সম্মত ক্লায়েন্ট
সংস্করণ ঠিক করতে পারে না।

**সমাধান:**
```js
// pages/_worker.js
const FORWARD_RESPONSE_HEADERS = [
  "content-type", "content-language", "cache-control", "etag", "last-modified",
  "link", "location", "vary", "x-robots-tag", "content-signal",
  // যোগ করুন:
  "mcp-protocol-version",
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-max-age",
  "x-content-source-date",
  "x-content-source-id",
];
```

### [Important] ৪১. `/openapi.json` ৪০৪ — llms.txt যে "machine-readable contract" বলে বিজ্ঞাপন করে সেটা নেই

**ফাইল:** `src/index.ts:121-126` (`splitSuffix`), `src/index.ts:399`

**সমস্যা:** `splitSuffix()` প্রতিটি পাথের শেষের `.json` সাফিক্স খুলে ফেলে, তাই রাউটার কখনও
`path === "/openapi.json"` মেলে না:
```ts
const m = /\.(md|json)$/.exec(p);
if (!m) return { path: p, forced: null };
return { path: p.slice(0, -m[0].length), forced: m[1] === "md" ? "markdown" : "json" };
// "/openapi.json" → path = "/openapi", forced = "json"
```
```ts
if (path === "/openapi.json") return openApi(env, ctxR);   // ← কখনও মিলে না
```

**প্রমাণ (live):**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dordekha.pages.dev/openapi.json   # 404
curl -s -o /dev/null -w "%{http_code}\n" https://dordekha.pages.dev/openapi        # 404
```
অথচ `llms.txt`-এ লেখা আছে:
> `- [OpenAPI spec](https://dordekha.pages.dev/openapi.json): the machine-readable contract.`

**প্রভাব:** একটি অ্যাসিস্ট্যান্ট যে "machine-readable contract" খুঁজতে আসে, পায় ৪০৪।
`/openapi.json` দেখানোর জন্য বোঝা হয় ঠিক যে `.json` সাফিক্স ধরা পড়ে।

**সমাধান:**
```ts
// src/index.ts — সাফিক্স খোলার আগে এই রুটটি ধরুন
const raw = url.pathname.replace(/\/+$/, "") || "/";
if (raw === "/openapi.json") return openApi(env, ctxR);
const { path, forced } = splitSuffix(raw);
```
(অথবা `splitSuffix`-এর আগে `if (url.pathname === "/openapi.json") …`।)

### [Important] ৪২. জাতীয় "গড়"-এর তিনটি ভিন্ন সংখ্যা, এবং উত্তর নিজের সাথে অসামঞ্জস্য

**ফাইল:** `src/index.ts:1291-1339` (`searchFact`, জাতীয় পথ), `src/mcp.ts:465-468` (`compareDistricts`)

**প্রমাণ (live, একই পণ্য "পেঁয়াজ", একই দিন):**
```
/api/v1/price?commodity=পেঁয়াজ
  "retail": {"min":42,"max":48.5,"avg":44.5,"median":44.5}
  "mean": 44.94,  "districts_reporting": 16,  "cheapest_district": 13, "dearest_district": 27

/price/onion-new-833  (meta description)
  "জাতীয় গড় ৪৪.৯৪ টাকা; 16টি জেলা থেকে তথ্য এসেছে।"

MCP compare_districts
  "district_average": 45.2,  "districts_reporting": 15,
  cheapest = 40 (পাবনা),  dearest = 49 (খুলনা)
```
**তিনটি সমস্যা একসাথে:**
1. **উত্তর নিজের সাথে অসামঞ্জস্য** — `cheapest_district`-এর প্রকৃত দর **৪০**, কিন্তু প্রকাশিত
   `retail.min` **৪২**; `dearest_district`-এর দর **৪৯**, কিন্তু `retail.max` **৪৮.৫**।
   অর্থাৎ **প্রকাশিত ব্যাপ্তির বাইরে** প্রকৃত দাম। (#৬-এর পরিবর্তনে)
2. **তিনটি ভিন্ন "জাতীয় গড়"** — ৪৪.৫ (API `avg`=মিডিয়ান), ৪৪.৯৪ (API `mean`, আর HTML-এ
   "জাতীয় গড়" বলে এটাই), ৪৫.২০ (MCP `district_average` — সেখানে আসলে সম-দিনের সরল গড়)।
   **একই ধারণা, তিনটি সংখ্যা, তিনটি পৃষ্ঠা।**
3. **`districts_reporting` ১৬ (API/HTML) বনাম ১৫ (MCP)** — কারণ MCP একই দিনে ফিল্টার করে,
   API করে না (#৭)।

**সমাধান:** একটি ধারণা, একটি সংজ্ঞা, একটি সংখ্যা — যেমন #৬ ও #৭-এর সমাধানে বলা।
সাইটের প্রতিটি পৃষ্ঠায় "জেলা-গড়" বলতে **একই সংখ্যা** বোঝাতে হবে; সবচেয়ে নিরাপদ হলো
একটি helper (`nationalFigure(rows)`) যা একবার হিসাব করে এবং তিনটি পৃষ্ঠাই তা ব্যবহার করে।

### [Important] ৪৩. `/api/v1/answer` ও `/api/v1/price` একই প্রশ্নে আলাদা আকৃতি ফেরত দেয়

**ফাইল:** `src/index.ts:1030-1082` (`/api/v1/answer`) বনাম `src/index.ts:1310-1340`

**সমস্যা:** জাতীয় স্কোপে `searchFact` যে ধরনের অবজেক্ট ফেরত দেয় (`mean`, `median`,
`outliers_excluded`, `cheapest_district`, `dearest_district`, `districts_reporting`),
`/api/v1/answer` সেটা **নতুন করে সাজিয়ে** ফেরত দেয় — ওই ক্ষেত্রগুলো বাদ পড়ে।

**প্রমাণ (live):** `/api/v1/price?commodity=পেঁয়াজ`-এ `mean` আছে; `/api/v1/answer?q=পেঁয়াজ`-এ
`mean` ফাঁকা (ক্ষেত্রটাই নেই), `districts_reporting` নেই, `cheapest_district` নেই।

**প্রভাব:** "অ্যাসিস্ট্যান্টের জন্য তৈরি" এন্ডপয়েন্টটি আসলে **কম তথ্য** দেয় — ঠিক যে পণ্যে
সবচেয়ে বেশি তথ্য দরকার।

**সমাধান:** `answer`-এর উত্তরে `searchFact`-এর ফল **সরাসরি** ছড়িয়ে দিন, `answer` ও
`citation` যোগ করুন:
```ts
const found = await searchFact(env, ctx, q);
if (found.error) { /* ... */ }
return json({ ...found, answer: answerText, citation: `...` }, ctx);
```

### [Important] ৪৪. দুটি প্রকাশ্য পৃষ্ঠা পরস্পরের বিরোধী — উপজেলার তথ্য

**ফাইল:** `src/index.ts:1459-1462` (`llms.txt`) বনাম `src/docs.ts` (`datasetDoc`)

**প্রমাণ (live):**
```
llms.txt     : "Upazila-level data: not yet available."
/dataset.json: ["উপজেলা", "৫০৫", "উপজেলা-ভিত্তিক তথ্য প্রকাশ করা হচ্ছে"]
```
আর প্রকৃত অবস্থা: **প্রতিটি প্রকাশ্য কোয়েরি `upazila_id = 0` ফিল্টার করে**
(`latestForCommodity`, `latestForDistrict`, `priceForDate`, `historyFor` — সবই)।
তাই কোথাও উপজেলা-সারি প্রকাশিত হয় না।

**প্রভাব:** একটি পৃষ্ঠা বলছে "নেই", অন্যটি বলছে "৫০৫ উপজেলা, প্রকাশ করা হচ্ছে"।
`/dataset`-এর লেখাটি **মিথ্যা** — কারণ `upazilaCount` ক্যাটালগের সংখ্যা, প্রকাশিত তথ্যের সংখ্যা নয়।

**সমাধান:** `/dataset`-এর উপজেলা-সারিতে "প্রকাশিত তথ্যের সংখ্যা" দেখান, ক্যাটালগের সংখ্যা নয়:
```ts
["উপজেলা", `${agg.upazilaCount}টি ক্যাটালগে আছে, কিন্তু উপজেলা-ভিত্তিক সারি এখনও প্রকাশ করা হয় না`, "—"]
```

### [Minor] ৪৫. ৫০৩ degraded উত্তর `Cache-Control: public, max-age=600` নিয়ে যায়

**ফাইল:** `src/index.ts:438-449`

**প্রমাণ (live):** ত্রুটিপূর্ণ MCP বডি → `503` এবং `Cache-Control: public, max-age=600`।

**প্রভাব:** একটি **ত্রুটির** উত্তর ১০ মিনিট ক্যাশে থাকে — ক্লায়েন্ট বা CDN পরের ১০ মিনিট
ভাঙা উত্তরই পাবে, এমনকি সার্ভার সুস্থ হয়ে গেলেও।

**সমাধান:**
```ts
return json({ error: "Service temporarily unavailable", ... }, fallback, 503);
// এই উত্তরে হেডার ওভাররাইড করুন:
const res = json({ ... }, fallback, 503);
res.headers.set("Cache-Control", "no-store");
return res;
```

### [Minor] ৪৬. MCP-এর `source` একটি স্ট্রিং — উৎসের URL নেই; `get_price_trend`-এ top-level `price_date` নেই

**ফাইল:** `src/mcp.ts:433`, `src/mcp.ts:571` বনাম `src/index.ts:847-851` (`SOURCE`)

**প্রমাণ (live):**
```
MCP get_market_price → "source": "কৃষি মন্ত্রণালয় / কৃষি বিপণন অধিদপ্তর (DAM)"   ← শুধু নাম
REST /api/v1/price  → "source": { "name": …, "url": "https://market.dam.gov.bd/…", "api": … }
MCP get_price_trend → structuredContent-এ কোনো top-level "price_date" নেই
   (keys: title, url, text, points, unit_bn, unit_en, change_pct, source)
```
**প্রভাব:** MCP ফলাফলে উৎসের **লিংক** নেই, আর ট্রেন্ড টুলে তারিখ টপ-লেভেলে নেই
(শুধু `points[].date`-এ)।

**সমাধান:** MCP-এ `source` কে `{ name, url, api }` বানান (REST-এর মতো), আর
`get_price_trend`-এর `structuredContent`-এ `price_date: last.priceDate` যোগ করুন।

### [Minor] ৪৭. robots.txt CSV নিষিদ্ধ করে, অথচ llms.txt ও /api তা বিজ্ঞাপন করে

**ফাইল:** `src/index.ts:1431` বনাম `src/index.ts:1505`, `src/docs.ts:488`

```
robots.txt : User-agent: * → Disallow: /api/v1/series.csv
llms.txt   : - CSV series: `GET ${base}/api/v1/series.csv?commodity=<id>&district=<id>`
/api       : GET /api/v1/series.csv?commodity=602&district=47
```
**প্রভাব:** ক্রলারকে নিষিদ্ধ, কিন্তু অ্যাসিস্ট্যান্টকে বিজ্ঞাপিত — নীতির ভেতরে অমিল।

### [Minor] ৪৮. নেভিগেশনের "MCP" লিংক ৪০৫ দেয়

**ফাইল:** `src/render.ts:422` (`<a href="/mcp">MCP</a>`), `src/index.ts:190-199`

`GET /mcp` → **৪০৫** ("Method Not Allowed")। পায়ের লিংকও একই। কোনো ডক পেজ নেই যা
বলে "POST JSON-RPC এখানে"।

**সমাধান:** `/mcp` GET-এর জন্য একটি ছোট ডক পেজ দিন (tools-এর তালিকা, উদাহরণ কোড)।

---

## ৪. নিরাপত্তা

### [Important] ১৯. `ADMIN_TOKEN` কোয়েরি প্যারামিটারেও নেওয়া হয়

**ফাইল:** `src/index.ts:241-248`

```ts
const provided = request.headers.get("X-Admin-Token") ?? url.searchParams.get("token");
if (!token || provided !== token) { return json({ error: "Forbidden" }, ctxR, 403); }
```

**সমস্যা:** (ক) টোকেন ইউর‌লে গেলে লগ, `Referer`, ব্রাউজার হিস্ট্রি ও এজ প্রান্সে লেখা হয়;
(খ) তুলনাটি সময়-স্থির নয় (constant-time নয়) — এটা নেটওয়ার্ক-স্তরে সম্পূর্ণ প্রাসঙ্গিক নয়,
তবে `crypto.subtle` ভিত্তিক তুলনা সহজেই করা যায়; (গ) `pages/_worker.js:60` পুরো
`pathname + search` ফরোয়ার্ড করে, তাই টোকেন ওয়ার্কারের লগে যায়।

**প্রভাব:** টোকেন লিক হলে সেটা URL-এ থেকে যায়। টোকেনটি `/internal/license/create` দিয়ে
**কাজ করে এমন API key** বানাতে পারে — অর্থাৎ ওই টোকেন একটি বাণিজ্যিক কেন্দ্র।

**সমাধান:** কোয়েরি প্যারামিটারের সমর্থন বাদ দিন এবং তুলনা ধ্রুব করুন:
```ts
if (path.startsWith("/internal/")) {
  const token = env.ADMIN_TOKEN;
  const provided = request.headers.get("X-Admin-Token");
  let ok = false;
  if (token && provided) {
    const a = new TextEncoder().encode(provided);
    const b = new TextEncoder().encode(token);
    ok = a.length === b.length && crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(a, b) : a.every((x, i) => x === b[i]);
  }
  if (!ok) return json({ error: "Forbidden" }, ctxR, 403);
```
(`crypto.subtle.timingSafeEqual` নেই; উপরের বিকল্পটি ঠিক আছে।
`pages/_worker.js`-এ `x-admin-token` ফরোয়ার্ড হয়, কিন্তু `authorization`-ও ফরোয়ার্ড হয় —
টোকেন হেডারেই রাখুন।)

### [Minor] ২২. ব্যক্তিগত তথ্য ট্র্যাকড ফাইলে ও লাইভ সাইটে

**প্রমাণ (গিট + কোড):**

| ফাইল:লাইন | কী |
|---|---|
| `src/docs.ts:614` | bKash ব্যক্তিগত ওয়ালেট — **লাইভ `/pricing` পেজে** |
| `wrangler.jsonc:72-73` | bKash নম্বর, টেলিগ্রাম চ্যানেল আইডি — **`vars`-এ, তাই public** |
| `docs/licence-letter-FINAL.txt:6,102,123` | ইমেইল `shourovehasan23@gmail.com` (HEAD-এ) |
| `docs/licence-letter-DAM.md:28,93` | মোবাইল (একটিতে টাইপো: ৯ সংখ্যা) |
| `docs/CUSTOMER-PROMPT-BN.md:89` | মালিকের নাম "শৌরভ হাসান" |
| `docs/SOCIAL-POST-BN.md:41` | বাড়ির জেলা/উপজেলা |
| `docs/Audit-Prompts report by multipul ai.txt` | `C:\Users\mdshi\...` মেশিন-পাথ |
| `docs/*.md` | `dordekha.shouroveh9.workers.dev` — ব্যক্তিগত CF হ্যান্ডেল |
| `docs/MASTER-PROMPT.md:82`, `tools/*.mjs` | CF অ্যাকাউন্ট আইডি |

**সমাধান:** ইমেইল/মোবাইল/NID ইতিহাস থেকে সরান (উপরে #১)। `wrangler.jsonc`-এর `vars`-এ
`BKASH_NUMBER` ও `TELEGRAM_CHANNEL` সরিয়ে Worker **secret**-এ নিন।
`docs/Audit-Prompts report by multipul ai.txt` ফাইলটি ইতিহাস থেকে সরান (এতে মেশিন-পাথ আছে)।

### [Minor] ২৩. রিপোজিটরিতে কোনো LICENSE ফাইল নেই, অথচ সাইট লাইসেন্স দাবি করে

**প্রমাণ:** `curl -s https://api.github.com/repos/mdshipon4045-afk/dordekha | grep license` → `"license":null`

সাইটের `/licence` পেজে CC BY দাবি আছে, আর `docs/licence-letter-DAM.md:132`-এ কপিরাইট
আইন ২০২৩ নিয়ে আলোচনা — কিন্তু নিজের কোডের জন্য কোনো লাইসেন্স ফাইল নেই।
**সমাধান:** `LICENSE` ফাইল যোগ করুন (MIT বা AGPL — ডেটা ও কোড আলাদা করে ব্যাখ্যা করুন)।

---

## ৫. paid tier-এর যুক্তি

### [Critical] ২. লাইসেন্স আসার আগেই বাণিজ্যিক প্ল্যান বিক্রি — `LICENCE_GRANTED` প্রোডাকশন সিক্রেটে সেট

**ফাইল:** `src/keys.ts:405-416`, `src/docs.ts:602-607`, `docs/FAILURE-MODES.md:52`

**সমস্যা:** কোডের বাণিজ্যিক গেট:
```ts
if (limits.requiresLicence && env.LICENCE_GRANTED !== "1") {
  throw new LicenceError("তথ্যের লাইসেন্স না আসা পর্যন্ত বাণিজ্যিক প্ল্যান দেওয়া যাবে না।", 403);
}
```
**গেটটি খোলা** — প্রোডাকশনে সিক্রেট সেট করা আছে:
```bash
npx wrangler secret list
# → ADMIN_TOKEN, INDEXNOW_KEY, LICENCE_GRANTED, TELEGRAM_BOT_TOKEN
```
কিন্তু:
- **DAM/ডিসিম লাইসেন্স এখনও সই হয়নি** (`PLAN.md:221` "❌", `FAILURE-MODES.md` গ-১ "⚠️ চিঠি প্রস্তুত, অপেক্ষায়")।
- **লাইভ `/pricing` পেজ বলছে:** "লাইসেন্স চালু হওয়ার আগে আমরা কোনো বাণিজ্যিক ফি নিই না" (`src/docs.ts:606`)।
- **`src/keys.ts:405-410`-এর মন্তব্য** স্বীকার করছে সিদ্ধান্তটি: "The owner decided … to work without waiting for that permission … the family covers any question that arises."

**প্রভাব:** (ক) **প্রকাশিত নীতি ও প্রয়োগ কাজ অমিল** — যে কেউ মূল্য পেজ পড়ে বিশ্বাস করবে যে এখন
টাকা নেওয়া হচ্ছে না; কোড টাকা নিতে প্রস্তুত। (খ) বাংলাদেশ কপিরা�াইট আইন ২০২৩
(§২৮ অনুযায়ী সরকারি তথ্য public domain নয়) — লাইসেন্স ছাড়া বাণিজ্যিক বিক্রি করলে এই
দায় থাকে। (গ) মূল্য পেজে ৬টি পণ্য বিক্রির অঙ্গীকার আছে, কোডে তার কোনো পথ নেই (নিচে #১২)।

**সমাধান — তিনটির একটি বেছে নিন, কিন্তু কথা ও কোড যেন এক হয়:**
1. **সবচেয়ে নিরাপদ:** `npx wrangler secret delete LICENCE_GRANTED` — গেট বন্ধ হয়ে যাবে,
   আর পেজের কথা সত্য হবে।
2. **অথবা** কোডে গেটটিকে "পরীক্ষামূলক" বানান: `LICENCE_GRANTED` = `"pilot"` হলে কেবল
   `free` ও `commercial` (সর্বোচ্চ ৫,০০০ কল/মাস) চালু হবে, `api`/`enterprise` নয়; আর
   `/pricing` পেজে লেখা থাকবে "পাইলট ফি, লাইসেন্স আসার পর সম্পূর্ণ"।
3. **অথবা** `/pricing` পেজের লাইসেন্স-অবস্থা-অংশটি `LICENCE_GRANTED`-এর উপর নির্ভরশীল করুন,
   যাতে সাইট সত্য বলে:
```ts
body: env.LICENCE_GRANTED === "1"
  ? "লাইসেন্স চালু আছে — বাণিজ্যিক ফি নেওয়া হচ্ছে।"
  : "কৃষি বিপণন অধিদপ্তরের সঙ্গে লাইসেন্সের আবেদন চলছে। লাইসেন্স চালু হওয়ার আগে আমরা কোনো বাণিজ্যিক ফি নিই না — এই ধাপে কেউ চাইলে বিনা টাকায় পাইলট ফি নিতে পারে।",
```
> **সুপারিশ:** লাইসেন্স চিঠি পাঠানোর আগে বিক্রি বন্ধ রাখা (১) সবচেয়ে সহজ ও সবচেয়ে নিরাপদ।
> মালিকের "পরিবার সামলাবে" সিদ্ধান্তটি আইনি ঝুঁকি নিজে বহন করছে — সেটি সঠিক হতে পারে,
> কিন্তু সেই সিদ্ধান্ত **সাইটের প্রকাশিত নীতির বিপরীতে** যাচ্ছে।

### [Important] ১২. মূল্য পেজের প্ল্যান কোডের সাথে মেলে না

**ফাইল:** `src/docs.ts:558-585` বনাম `src/keys.ts:50-57`

**প্রমাণ:**

| মূল্য পেজে (`/pricing`) | দাম | কোডে (`PLAN_LIMITS`) |
|---|---|---|
| উন্মুক্ত | ৳০ | `free` — ২,০০০ কল/মাস, burst ৬০ |
| বাণিজ্যিক API | ৳২,০০০ | `commercial` — ৫০,০০০ কল/মাস, burst ৩০০ |
| **বাল্ক ডেটা** | **৳১০,০০০** | **কোনো প্ল্যান নেই** |
| **অ্যালার্ট** | **৳৫০০** | **কোনো প্ল্যান নেই** |
| **MCP server** | **৳৩,০০০** | **কোনো প্ল্যান নেই** |
| এন্টারপ্রাইজ | "প্রতিবেদন" | `enterprise` — আনলিমিটেড, burst ৩,০০০ |
| — | — | **`api` — ৫,০০০ কল/মাস, burst ৯০০ (কোথাও দাম নেই)** |

**সমস্যা:** (ক) পেজে বিক্রি হওয়া দুটো পণ্য (বাল্ক ডেটা, অ্যালার্ট) কেনা যায় না —
`issueLicense` অজানা প্ল্যানে ৪০০ দেয় (`src/keys.ts:401-403`); (খ) কোডের `api` ও
`enterprise` প্ল্যানের কোনো প্রকাশিত দাম নেই; (গ) কোনো কোটা বা burst সংখ্যা প্রকাশিত নেই;
(ঘ) পেজে "উন্মুক্ত" বলা হয়েছে "সীমিত REST API" — কিন্তু কোডে কী ছাড়া **কোনো সীমা নেই** (নিচে #২৬)।

**প্রভাব:** একজন ক্রেতা ৳১০,০০০ দিয়ে "বাল্ক ডেটা" কিনতে চাইলে সেটা কেনা যায় না।
বিপরীতভাবে, কোডে যে কোটা আছে সেটা ক্রেতা জানতে পারে না — একটি কেনাবেচার সম্পর্ক
অনিশ্চিত।

**সমাধান:** একটি সত্য-সূত্র বানান — মূল্য পেজ **কোড থেকে** পড়ুন:
```ts
// src/keys.ts
export const PLAN_PRICES_BDT: Record<Plan, number> = {
  free: 0, commercial: 2000, api: 10000, enterprise: 0,
};
export const PLAN_LABELS_BDT: Record<Plan, string> = {
  free: "উন্মুক্ত", commercial: "বাণিজ্যিক API", api: "বাল্ক ডেটা", enterprise: "এন্টারপ্রাইজ",
};
// src/docs.ts — pricingDoc-এ ছকটা PLAN_LIMITS/PLAN_PRICES_BDT থেকে তৈরি করুন
```
অ্যালার্ট ও MCP-এর আলাদা প্ল্যান না থাকলে সেগুলো কোডে যোগ করুন, অথবা পেজ থেকে সরান।
পেজে কোটার সংখ্যাও লিখুন: "৫০,০০০ কল/মাস · ৫ মিনিটে সর্বোচ্চ ৩০০"।

### [Important] ১৩. burst guard কার্যত ৫ মিনিটের নয়, ~১০ সেকেন্ডের উইন্ডোতে কাজ করে

**ফাইল:** `src/keys.ts:196` (`LIC_CACHE_TTL = 10`), `src/keys.ts:225-253` (`verifyLicense`),
`src/keys.ts:269-313` (`recordUsage`), `src/keys.ts:167-183` (`checkAccess`)

**সমস্যা:** লাইসেন্সের কাউন্টার **ক্যাশে** থাকে (`LIC_CACHE_TTL = 10` সেকেন্ড), আর
`recordUsage` কাউন্টার বাড়ানোর পর **ক্যাশ আপডেট করে না** — শুধু D1-তে লেখে। ফলে:

- ১০ সেকেন্ডের মধ্যে আসা সব অনুরোধ একই পুরনো `burstCount` দেখে → **সবগুলোই গার্ড পাস করে**।
- ১০ সেকেন্ড পর ক্যাশ মেসে যায় → ক্যাশ মিস → D1 থেকে আসল কাউন্টার পড়া হয়।

ফলে "৫ মিনিটে সর্বোচ্চ ৬০" বাস্তবে **"১০ সেকেন্ডে ৬০"** — **৩০ গুণ** দুর্বল।
KV পড়া eventual-consistent হওয়ায় (৬০ সেকেন্ড পর্যন্ত) ক্যাশ আরও পুরনো হতে পারে।
মাসিক কোটার রোলওভার সঠিক (`lic.period === currentPeriod()` → `src/keys.ts:174`),
কিন্তু ক্যাশের কারণে সেটিও ১০ সেকেন্ড পিছিয়ে।

**প্রমাণ (কোড):** `verifyLicense` → `env.CACHE.put(cacheKey, JSON.stringify(licence), { expirationTtl: LIC_CACHE_TTL })`
(লাইন ২৪৯) — `recordUsage` (লাইন ২৬৯-৩১৩) কোথাও `env.CACHE.put` করে না।

**প্রভাব:** একটি ক্লায়েন্ট সচেতনভাবে burst করে খুব বেশি কল করতে পারে — এবং প্রতিটি কল
D1-এ ২টি সারি লেখে, তাই লেখার বাজেটও খাটে।

**সমাধান:**
- (ক) ক্যাশে **শুধু স্থির তথ্য** রাখুন (plan, expiresAt, active, callsLimit), **কাউন্টার নয়**;
  কাউন্টার সবসময় D1 থেকে পড়ুন (O(1), একটি indexed row) — যা মূল মন্তব্যেই বলা হয়েছে
  ("A cache miss is one indexed row")।
- (খ) burst গার্ডকে **পরমাণাবলি** করুন — D1-এ একটি ছোট কাউন্টার টেবিলে
  `INSERT ... ON CONFLICT DO UPDATE SET n = n + 1` + উইন্ডো-স্ট্যাম্প, তারপর
  `SELECT n FROM ... WHERE window = ?` — একটি অ্যাটমিক রাইট, TOCTOU নেই:
```sql
INSERT INTO burst (license_id, window, n) VALUES (?,?,1)
  ON CONFLICT(license_id, window) DO UPDATE SET n = n + 1;
SELECT n FROM burst WHERE license_id = ? AND window = ?;
```
- (গ) যদি ক্যাশে রাখতেই হয়, তাহলে `recordUsage`-এ ক্যাশটিও আপডেট করুন (মিস হলে আবার লিখতে হবে —
  সেটাই KV লেখার বাজেট, তাই (ক) বেটার)।

### [Minor] ৩১. একটি keyed কল দুটো রাইট করে, কিন্তু কোডের মন্তব্য "একটি রাইট" বলে

**ফাইল:** `src/keys.ts:19-21` (মন্তব্য) বনাম `src/keys.ts:280-296` (কোড)

```ts
// মন্তব্য: "a keyed call costs exactly **one** write, and a refused call costs **none**"
// কোড: db.batch([ UPDATE license, INSERT usage_event ])   ← ২টি সারি লেখা
```
`usage_event` কখনও মুছে ফেলা হয় না — `commercial` প্ল্যানে ৫০,০০০ কল/মাস = মাসে ৫০,০০০ সারি
চিরকাল থাকবে, আর ইনডেক্সসহ বাড়তে থাকবে।

**সমাধান:** `usage_event`-এর বদলে একটি **দৈনিক** কাউন্টার টেবিল রাখুন
(`usage_daily(license_id, day, n)`), আর সেটি `recordUsage`-এ আপডেট করুন;
বিস্তারিত ইভেন্ট লাগলে ৯০ দিন পর প্রুন করুন।
অথবা মন্তব্যটি বদলে "two writes" লিখুন — কিন্তু তারপর লিখার বাজেটের হিসাবটিও বদলাতে হবে (#১৮)।

### [Minor] ৩৩. গ্রাহকের তথ্য কোথায় জমা হয় ও লগে যায় কি না

**ফাইল:** `src/keys.ts:428-441` (`issueLicense`), `src/index.ts:303-305` (`/internal/license/list`)

- `license.contact` (ইমেইল) ও `license.label` → D1-তে সংরক্ষিত।
- `usage_event`-এ শুধু `license_id, at, endpoint, source, status` — **ইমেইল নেই**। ভালো।
- `console.error("request failed", url.pathname, message, ...)` (`src/index.ts:436`) — ইমেইল লগ হয় না। ভালো।
- `/internal/license/list` সব লাইসেন্সের `contact` ফেরত দেয় — কিন্তু ADMIN_TOKEN-এর পিছনে। ভালো।

**সংক্ষেপে: ঠিক আছে।** শুধু লক্ষ্য করুন, `/internal/license/*` টোকেন যেন কখনও URL-এ না যায় (#১৯)।

---

## ৬. MCP ও API-র আচরণ

### [Important] ১৪. MCP ত্রুটিপূর্ণ বডিতে JSON-RPC `-32700` নয়, ৫০৩ দেয়

**ফাইল:** `src/index.ts:211` (`await request.json()`), `src/index.ts:430-449` (বাইরের catch)

**প্রমাণ (live):**
```bash
curl -s -i -X POST https://dordekha.pages.dev/mcp \
  -H "Content-Type: application/json" -d 'hello'
# → HTTP/1.1 503 Service Unavailable
# { "error": "Service temporarily unavailable", "status": "degraded", ... }
```
**সমস্যা:** JSON-RPC 2.0 অনুযায়ী অবৈধ JSON-এর জন্য `-32700 Parse error` এবং বৈধ JSON-এর
অশুদ্ধ বডির জন্য `-32600 Invalid Request` লাগে। এখানে ৫০৩ + একটি সাধারণ "degraded"
বডি — যা MCP ক্লায়েন্টকে সার্ভার-ডাউন ভাবতে দেয়, আর পরিষ্কার ত্রুটির বদলে রিট্রাই করতে
উৎসাহিত করে।

**প্রভাব:** একটি বাজে ফরম্যাটের MCP ক্লায়েন্ট ৫০৩ দেখে অপেক্ষা করে বা বারবার চেষ্টা করে।
বার্তার ভেতরে `/mcp` পাথ ও "degraded" স্ট্যাটাস প্রকাশিত হচ্ছে।

**সমাধান:**
```ts
if (path === "/mcp") {
  ...
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, ctxR, 200);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, ctxR, 200);
  }
  const req = body as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
  if (req.method === undefined || typeof req.method !== "string") {
    return json({ jsonrpc: "2.0", id: req.id ?? null, error: { code: -32600, message: "Invalid Request" } }, ctxR, 200);
  }
  ...
}
```

### [Minor] ২৫. MCP ব্যাচ (অ্যারে) অনুরোধ ভুলভাবে `-32601` দেয়

**প্রমাণ (live):**
```bash
curl -s -X POST https://dordekha.pages.dev/mcp -H "Content-Type: application/json" \
  -d '[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]'
# → {"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not found: undefined"}}
```
**সমাধান:** উপরের ইন-ভ্যালিডেশনে অ্যারে ধরা পড়লে ব্যাচ প্রসেস করুন, নয়তো `-32600 Invalid Request`:
JSON-RPC-এ ব্যাচ একটি বৈধ অনুরোধ, তাই সঠিক উত্তর হলো প্রতিটি উপাদানের উত্তরের একটি অ্যারে
(`[{"result":…},{"error":…}]`)। একটি বাস্তব MCP ক্লায়েন্ট ব্যাচ পাঠালে বর্তমানে ভুল উত্তর পাবে।

### [Important] ১৫. MCP CORS preflight (OPTIONS) 405 দেয় — ডেড কোড

**ফাইল:** `src/index.ts:189-225`

**সমস্যা:** `OPTIONS` ব্যবস্থাপনার শাখটি (`src/index.ts:223-225`) **কখনও চলে না**:
```ts
if (path === "/mcp") {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed", ... }, ctxR, 405);   // ← এখানেই ফিরে যায়
  }
  ...
}
if (path === "/mcp" && request.method === "OPTIONS") {                 // ← অপ্রাপ্য
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
}
```
**প্রমাণ (live):**
```bash
curl -s -i -X OPTIONS https://dordekha.pages.dev/mcp
# → HTTP/1.1 405 Method Not Allowed
#   (Access-Control-Allow-Origin হেডার নেই)
```
**প্রভাব:** ব্রাউজার-ভিত্তিক MCP ক্লায়েন্ট (ও WebSocket/Streamable-HTTP ওয়েব UI) preflight
পাঠালে ব্যর্থ হয়। `Access-Control-Allow-Origin: *` শুধু POST উত্তরে আছে (`src/index.ts:220`)।

**সমাধান:** `OPTIONS` চেকটি `POST` চেকের **আগে** সরান:
```ts
if (path === "/mcp") {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    }});
  }
  if (request.method !== "POST") { ... 405 ... }
```
(`pages/_worker.js:32-41`-এ `FORWARD_REQUEST_HEADERS`-এ `origin` নেই — CORS preflight-এ
`Origin` ও `Access-Control-Request-*` হেডার পাঠাতে হবে; সেগুলো যোগ করুন।)

### [Important] ১৬. CSV এক্সপোর্টে এককের কলাম নেই, উৎসের উল্লেখ নেই

**ফাইল:** `src/index.ts:1100-1133`

**প্রমাণ (live):**
```
price_date,commodity_id,district_id,retail_min,retail_max,retail_avg,wholesale_min,wholesale_max,wholesale_avg,carried_forward,anomaly
2026-10-17,833,47,40,45,43,34,38,36,0,
2026-10-18,833,47,42,46,44,35,38,36.5,0,
2026-10-19,833,47,43,47,45,36,40,38,0,
```
**সমস্যা:** (ক) **এককের কলাম নেই** — ক্রেতা জানে না ৪৫ টাকা প্রতি কেজি, প্রতি পিছ নাকি
প্রতি ডজন। পণ্যের একক ভিন্ন (কেজি / ৪ পিছ / ১ পিছ / লিটার) — তাই এটি ব্যবহারযোগ্য নয়।
(খ) **উৎসের কোনো উল্লেখ নেই** — CSV-তে কোন তারিখে কোথা থেকে নেওয়া, তা নেই।
(গ) `is_midpoint` (সত্যিটা কোডে খুব গুরুত্বপূর্ণ) ও `divisor`/`divisor_source` নেই।
(ঘ) `since` প্যারামিটারের তারিখ ফরম্যাট যাচাই নেই (তবে `historyFor`-এ বাইন্ড ভেরিফায় করা হয়)।

**প্রভাব:** এই CSV-ই বাল্ক-ডেটা পণ্যের (৳১০,০০০) মূল্য পণ্য — আর সেটি এখন
একক-হিসাব ছাড়া, উৎস-হিসাব ছাড়া, ভুল-ব্যাখ্যা-ঝুঁকিপূর্ণ।

**সমাধান:**
```ts
const lines = [
  "# source: কৃষি মন্ত্রণালয় / DAM daily price report — https://market.dam.gov.bd/market_daily_price_report",
  "# data: দরদেখা (https://dordekha.pages.dev) · unit_retail: কেজি · wholesale আগের retail unit-এ ভাগ করা",
  "price_date,commodity_id,commodity_name_bn,district_id,district_name_bn,retail_min,retail_max,retail_avg,retail_unit,retail_is_midpoint,wholesale_min,wholesale_max,wholesale_avg,wholesale_unit,wholesale_divisor,wholesale_divisor_source,carried_forward,anomaly",
];
```
(এতে ফাইলের প্রথম দুটি লাইন `#`-দিয়ে শুরু, তাই বেশিরভাগ CSV পাঠকারী লাইনটি কমেন্ট হিসেবে নেবে।)

### [Minor] ২৪. `divisor` ধারণার তিন রকম নামকরণ একই ধাপে

**ফাইল:** `src/index.ts:986-987` (`divisor`, `divisor_source`) বনাম `src/index.ts:1270`
(`divisor`, `divisorSource`) বনাম `src/render.ts:910-919` (ফ্যাক্ট JSON-এ **নেইই**)

**প্রমাণ:** `/api/v1/latest` → `wholesale.divisor_source`; `/api/v1/search` → `wholesale.divisorSource`;
`/price/<c>/<d>/<date>.json` → `wholesale`-এ `divisor` নেইই।

**প্রভাব:** একটি কনজিউমার তিনটি এন্ডপয়েন্টে তিন রকম স্পেলিং পায়; আর সবচেয়ে
গুরুত্বপূর্ণ এন্ডপয়েন্টেই (একক-ধারণার প্রতিটি ফ্যাক্ট) উৎস অনুপস্থিত — যে কারণে
#১০-এর ভুল ইউনিট চিহ্নিত করা যায় না।

**সমাধান:** একটি ধারণা, একটি নাম — `divisor` ও `divisor_source` — তিনটি জায়গাতেই।

### [Minor] ৩৯. MCP `tools/call` ইনপুট স্কিমা যাচাই করে না

**ফাইল:** `src/mcp.ts:229-245`, `src/mcp.ts:314`

**প্রমাণ (কোড):** `const days = Math.min(400, Math.max(3, Number(args.days ?? 30)));`
— `args.days = "abc"` হলে `NaN` → `new Date(NaN).toISOString()` → `RangeError` →
টুলের `isError` উত্তরে অভ্যন্তরীণ বার্তা। `args.commodity = {}` হলে `String({})` = "[object Object]"।

**সমাধান:** প্রতিটি টুলের আর্গুমেন্টের ধরন যাচাই করুন এবং `-32602 Invalid params`
ফেরত দিন:
```ts
if (name === "get_price_trend") {
  const raw = args.days ?? 30;
  const days = typeof raw === "number" && Number.isFinite(raw) ? Math.min(400, Math.max(3, raw)) : 30;
  ...
}
```

---

## ✅ যা পরীক্ষা করেছি কিন্তু ঠিক পেলে

1. **XSS — কোনো ধরনের নেই।** `esc()` (`src/render.ts:46-49`) সব জায়গায় ব্যবহার হয়েছে;
   `/verify?claim=<script>alert(1)</script>` → `&lt;script&gt;` হয়ে আসে (raw নয়)।
2. **SSRF — নেই।** `pages/_worker.js:29,60` একটি **নির্দিষ্ট** origin-এ ফরোয়ার্ড করে;
   কোনো এন্ডপয়েন্ট ইউজার-দেওয়া URL ফেচ করে না।
3. **`/internal/*` fail-closed।** টোকেন না দিলে ৪০৩, ভুল টোকেনে ৪০৩ (live যাচাই করা)।
4. **সিক্রেটের মান কোনো কমিটে নেই।** `git log -p --all -- .dev.vars .secrets.env` ফাঁকা;
   ADMIN_TOKEN / TELEGRAM_BOT_TOKEN / INDEXNOW_KEY / CF token / Gmail password — কোনোটিই
   ইতিহাসে নেই। `.gitignore` সব সংবেদনশীল ফাইল ঠিকভাবে আড়াল করে;
   `git status --short` পরিষ্কার।
5. **অস্বীকৃত কলে কোনো রাইট হয় না।** `enforceAccess` (`src/keys.ts:357-362`) চেক ব্যর্থ হলে
   `recordUsage` ডাকে না — ডিবি-রাইট বাজেট নষ্ট হয় না। ✅
6. **মাসিক কোটার রোলওভার ঠিক।** `lic.period === currentPeriod(now) ? lic.callsUsed : 0`
   (`src/keys.ts:174`) — আগের মাসের কাউন্টার শূন্য পড়ে। ✅
7. **`/api/v1/latest`-এ district আবশ্যক; না দিলে ৪০০, অচেনা জেলা দিলে ৪০০** (live যাচাই করা)।
8. **যে তারিখে উৎসে তথ্য নেই, সেখানে সংখ্যা বানানো হয় না।** `/price/<c>/<d>/2020-01-01` → ৪০৪
   + "এই তারিখে তথ্য নেই" পাতা; ফ্যাক্ট পেজের canonical ঠিক সেই পাতার।
9. **পাইকারি সত্যিই খুচরার এককে প্রকাশিত হয়** (`src/normalize.ts:114`) — e2e যাচাই করেছে।
   (তবে যাচাই-হয়না জোড়ার ক্ষেত্রে — #১০।)
10. **"avg" আসলে (min+max)/2 — এটা সৎভাবে বলা হয়** (`is_midpoint`, `src/quality.ts:77-79`)।
11. **মুভার্স-বোর্ড ১০০%-এর বেশি লাফ বাদ দেয় ও anomaly-যুক্ত সারি বাদ দেয়** (`src/db.ts:1062,1055`).
12. **`price_latest` সময়ের পিছনে যায় না** (`src/db.ts:683`, `WHERE excluded.price_date > price_latest.price_date`)।
13. **MCP `compare_districts` একই দিনের সারি বেছে নেয়** (`src/mcp.ts:462-463`) — ভালো করা।
14. **একটি ফ্যাক্টের সব পৃষ্ঠা একই সত্য থেকে** — `resolveFact` (`src/db.ts:421`) একটিমাত্র
    ফাংশন; পেজ, REST ও MCP তিনটিই তার ভেতর দিয়ে যায়।
15. **ইনডেক্স আছে — এবং প্রোডাকশন D1-তে সত্যিই প্রয়োগ হয়েছে।** রিমোট স্কিমা পরীক্ষা করা:
```bash
npx wrangler d1 execute dordekha --remote --command \
 "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('price_daily','price_latest')"
# → idx_pd_commodity_date, idx_pd_date, idx_pd_date_district, idx_pd_district_commodity,
#   idx_pd_district_date, idx_pl_commodity, idx_pl_district
```
   `REQUIRED_INDEXES`-এর ছয়টিই আছে। প্ল্যানার ইউজ হচ্ছে (কোয়েরির `rows_read` মাপায়
   স্ক্যান না হয়ে সিলেক্ট হচ্ছে)। `license` টেবিলে `period`, `burst_count`, `burst_window`
   কলামও প্রোডাকশনে আছে (তাই #২৮ আজ লাভটির নয়, অদৃশ্য ঝুঁকি)।
16. **KV-র কী-সংখ্যা ১,০০০-এর নিচে** — ৩৯৪টি কী মাপা হয়েছে (৩৮৫টি ইতিহাসের শার্ড +
   ৯টি অন্যান্য)। তাই কী-সংখ্যার সীমা এখনই সমস্যা নয়; **লেখার সংখ্যাই** সমস্যা (#৩)।
17. **৫০০-এর ভেতরে কোনো অভ্যন্তরীণ বিবরণ প্রকাশ হয় না** — `/internal/health`, `/health` ও 404-এ
    D1/কোটা/স্ট্যাক কিছুই নেই (live যাচাই করা)।
17. **`tool` ফলাফলে `url` ও `title` আছে** (OpenAI-র citation প্রয়োজন অনুযায়ী) — e2e যাচাই করেছে।
18. **উৎসের URL সঠিক** — `https://market.dam.gov.bd/market_daily_price_report` (API এন্ডপয়েন্ট নয়)।
19. **`/api/v1/units` এককের লেজেন্ড দেয়** — অক্ষর-সংখ্যার একক-কোড আর কোনো অস্পষ্টতা নেই।
20. **`/health` সাধারণ মনিটরের জন্য যথেষ্ট, আর ইন্টারনাল অবস্থা `/internal/health`-এ** — ✅
21. **টেস্ট ও ই-টেস্ট দুটোই সবুজ** — ১৩৭/১৩৭ ইউনিট, ৬০/৬০ ই-টেস্ট (লাইভ)।
22. **উৎসে ২০২৬-১০-২০/২১/২২-এ তথ্য নেই** — সাইটের সর্বশেষ তারিখ ২০২৬-১০-১৯ সঠিক, সাইট কোনোদিন
    কমিয়ে বলেনি (উৎসে সরাসরি যাচাই করা)।
23. **D1 ডেটাবেজে কোনো ব্যক্তিগত তথ্য নেই** — শুধু সরকারি দাম, `district`/`commodity` রেফারেন্স।
24. **canonical ঠিকানা ঠিক সেই পাতারই, তারিখসহ** (live যাচাই) —
    `/price/onion-new-833/dhaka/2026-10-19` → `<link rel="canonical" href="…/2026-10-19">`
    এবং পেজের ভেতরে অন্য কোনো তারিখ-স্ট্রিং নেই।
25. **ফ্যাক্ট পেজের সংখ্যা API-র সাথে হুবহু মেলে** (live) — পেজ: "খুচরা ৪৩–৪৭ টাকা প্রতি
    কিলোগ্রাম, পাইকারি ৩৬–৪০" · `/api/v1/latest?district=47` → `min 43, max 47, avg 45 /
    wholesale min 36, max 40, avg 38`। তিনটি representation একই সত্য।
26. **carry-forward লেবেল HTML ও JSON-এ মেলে যায়** (live) — HTML-এ `<span class="stamp carry">পূর্বের</span>`,
    `.json`-এ `"carried_forward": true`, `.md`-এ "আগের প্রতিবেদন থেকে পুনরায় ব্যবহার করা হয়েছে"।
27. **যে তারিখে উৎসে তথ্য নেই, সেখানে কোনো সংখ্যা বানানো হয় না** — live ৪০৪ পেজে স্পষ্ট লেখা:
    "কোনো অন্য তারিখের সংখ্যা এখানে বসানো হয়নি — ভুল তারিখে ভুল দাম দেওয়ার চেয়ে ফাঁকা থাকা ভালো।"
    (তবে #২৭ — D1 বন্ধ হলে এই পাতাটি ৪০৪ দেয়, যদিও ক্যাশে ডেটা আছে।)

---

## ❓ যা পরীক্ষা করতে পারিনি (কারণসহ)

1. **প্রোডাকশনে `LICENCE_GRANTED`-এর মান** — সিক্রেটের **নাম** দেখা যায় (`wrangler secret list`
   → `LICENCE_GRANTED` আছে), মান নয়। গেটটি খোলা কি না তা বোঝার জন্য `ADMIN_TOKEN` দিয়ে
   `/internal/license/create` কল করতে হতো — আমি উজ্জ্বল বাণিজ্যিক কী বানিয়ে ফেলতে ইচ্ছা করিনি।
   **সম্ভব হলে মালিক একটি বিয়োগ-পরীক্ষা (dry-run) করুন** (যেমন `free` প্ল্যান, ১ মাস)।
2. **KV লেখা সত্যিই ফেলে দেওয়া হচ্ছে কি না** — Cloudflare-এর GraphQL-এ KV-এর
   অপারেশন-টাইপ/স্ট্যাটাস ভাঙ্গা (`unknown field "operationType"`, `unknown field "status"`),
   আর `.secrets.env`-এর API টোকেনে GraphQL-এর authz নেই (OAuth টোকেন দিয়ে কাজ করেছে, কিন্তু
   ওই ডেটাসেটেও স্ট্যাটাস নেই)। **অনুমান** করা হয়েছে: কোডের হিসাব (৮,৬৪০ লেখা/দিন)
   + পর্যবেক্ষণ (স্ক্যান করা তারিখের শার্ড অনুপস্থিত)। নিশ্চিত করতে Worker-এর লগে KV ত্রুটি
   লিখুন (সমাধানের অংশ হিসেবে দেওয়া আছে)।
3. **২১ অক্টোবরে D1 রিড কোটা ছাড়ালে সাইট ঠিক কী দেখিয়েছিল** — ৭,৩২৬,৪২৭ সারি পড়ার পর
   Cloudflare কী প্রতিক্রিয়া দিয়েছিল (বন্ধ করেছে? চার্জ করেছে?) তা ইতিহাস থেকে বোঝা যায়নি।
4. **আসল ভিজিটর ও ট্রাফিকের পরিমাণ** — Cloudflare Analytics-এর ওয়ার্কার-ভিত্তিক ট্রাফিক ডেটা
   পড়তে পারিনি (শুধু D1/KV বিশ্লেষণ পেয়েছি)। তাই "৯৮ হোম-পেজ ভিউ/দিন" হিসাবটি
   প্রকৃত ট্রাফিকের উপর নয় — এটি **ক্ষমতার** সীমা।
5. **`initialize` মেথডের প্রয়োজনীয়তা** — কোডের দাবি "MCP 2026-07-28 স্টেটলেস"। এই স্পেসিফিকেশন
   সংস্করণটি আমি সরাসরি যাচাই করতে পারিনি (আমার জ্ঞানের বাইরে)। বাস্তব MCP ক্লায়েন্ট যদি
   এখনও `initialize` পাঠায়, সেটি `-32601` পাবে। **ঝুঁকি হিসেবে নোট করা হলো, দাবি হিসেবে নয়।**
6. **আসল MCP ক্লায়েন্ট (Claude Desktop, Cursor) দিয়ে হ্যান্ডশেক** — MCP SDK নেই এই পরিবেশে।
7. **Telegram চ্যানেলের প্রকৃত কার্যক্রম** — বট কি অ্যাডমিন, ডাইজেস্ট কি যাচ্ছে, তা দেখিনি।
8. **Cloudflare-এর AI Crawl Control সেটিং** (PLAN.md Phase 3-এর টাস্ক) — ড্যাশবোর্ডে যাইনি।
9. **D1-এর ব্যাকআপ ও `d1 export`** — `backup.sql` আছে কিন্তু পুরোনো; পুরো রিস্টোর যাচাই করিনি।
10. **লোড/পারফরম্যান্স টেস্ট** — চালানো হয়নি।

---

## 🔧 সাজানো করার ক্রম (প্রস্তাবিত)

| ক্রম | কাজ | কতক্ষণ |
|---|---|---|
| ১ | **রিপো private করা + ইতিহাস পরিষ্কার + NID বদলানোর আবেদন** (#১) | আজই |
| ২ | **KV লেখা ৮.৬× কমানো + ত্রুটি লগ করা** (#৩) | ১ দিন |
| ৩ | **অ্যাগ্রিগেট রিফ্রেশ সারাক্ষণ + কোয়েরি একীভূত করা** (#৪) | ১ দিন |
| ৪ | **লাইসেন্স গেট ও মূল্য পেজের অমিল মিটানো** (#২, #১২) | ১ ঘণ্টা |
| ৫ | **জাতীয়-স্কোপের তারিখ-মিশ্রণ ও min/max ঠিক করা** (#৬, #৭, #৮, #৯) | ২ দিন |
| ৬ | **CSV-তে একক + উৎস + divisor যোগ করা** (#১৬) | ২ ঘণ্টা |
| ৭ | **MCP পার্স-এরর, ব্যাচ, OPTIONS** (#১৪, #১৫, #২৫) | ৩ ঘণ্টা |
| ৮ | **burst guard পরমাণাবলি করা** (#১৩) | ১ দিন |
| ৯ | **একক-যাচাই-ব্যর্থ পাইকারি বাদ দেওয়া + carry-forward আলাদা পতাকা** (#১০, #১১) | ১ দিন |
| ১০ | **`ingest_run`-এর হিসাব ঠিক করা + বাজেট গার্ড শক্তিশালী করা** (#১৭, #১৮) | ৪ ঘণ্টা |
| ১১ | **ADMIN_TOKEN কোয়েরি প্যারামিটার বন্ধ + ব্যক্তিগত তথ্য সরানো** (#১৯, #২২) | ২ ঘণ্টা |
| ১২ | **মুভার্স-বোর্ড শার্ডযুক্ত ক্যাশে নেওয়া** (#২০) | ২ ঘণ্টা |
| ১৩ | **Pages ফ্রন্টের হেডার allow-list ঠিক করা** (#৪০) — একটি লাইনের কাজ, কিন্তু MCP-এর CORS, প্রটোকল-সংস্করণ ও ডেটার-তারিখের হেডার তিনটিই ফিরিয়ে আনে | ১৫ মিনিট |
| ১৪ | **`/openapi.json` ঠিক করা** (#৪১) — `splitSuffix`-এর আগে রুটটি ধরা; llms.txt-এর "machine-readable contract" তখন সত্য হবে | ১৫ মিনিট |
| ১৫ | **জাতীয়-স্কোপের সংখ্যা এক করা** (#৪২, #৪৩) — একটি helper, তিনটি পৃষ্ঠা; আর "জেলা-গড়" তিন রকম সংখ্যা | ১ দিন |
| ১৬ | **দুই প্রকাশ্য পৃষ্ঠার অমিল মিটানো** (#৪৪) — উপজেলা-র দাবি; আর `prices: {retail: null}` অসামঞ্জস্য | ২ ঘণ্টা |
| ১৭ | **তারিখ-নির্দিষ্ট পার্মালিংকের ডিবি-ব্যর্থতা-ব্যাকআপ** (#২৭) — শার্ডযুক্ত ইতিহাস ব্যবহার করা | ১ ঘণ্টা |
| ১৮ | **`recordUsage` ফলব্যাকে রোলওভার** (#২৮) | ৩০ মিনিট |
