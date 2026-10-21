# ডোমেইন ও হোস্টিং — সেটআপ গাইড (বাংলায়)

> **✅ ২১ অক্টোবর: `https://dordekha.pages.dev` লাইভ** — ব্র্যান্ডেবল, ইনডেক্সযোগ্য,
> canonical, আর MCP উদ্ধৃতি লিংক এখন এই ঠিকানায়।
>
> এটা **একটি ব্রিজ**। `pages.dev` একটি shared free suffix — নিজের authority নেই, আর যেকোনো
> দিন বন্ধ হতে পারে। তাই নিচের "স্থায়ী ডোমেইন"-এর পথটাও চালু রাখা দরকার।
>
> আগের ঠিকানা `dordekha.shouroveh9.workers.dev` **এখনো চলছে** (পেছনে, fallback হিসেবে) —
> সেটা বন্ধ করা হয়নি।

---

## এখন কী আছে

| বিষয় | অবস্থা |
|---|---|
| **পাবলিক ঠিকানা** | `https://dordekha.pages.dev` ✅ |
| **হোস্টিং** | Cloudflare Pages (ফ্রি) → প্রক্সি → Worker (D1 + KV + ক্রন) |
| **কেন্দ্রীয় উৎস** | এখনও এক: `C:\Power of AI\dordekha` — দুই কপি নেই, শুধু একটি প্রক্সি |
| **SSL** | Cloudflare দেয়, নিজে থাকে |
| **খরচ** | ৳০ |
| **কী করতে হয়নি** | কোনো VPS, কোনো cPanel, কোনো পেইড প্ল্যান |

### কেন Pages-প্রক্সি, Worker নয়

Worker-এর কাছে **D1, KV আর প্রতি-মিনিটের ক্রন** আছে — ক্রোন ছাড়া দাম আজ আর হয় না। Pages-এ
ক্রন নেই। তাই Worker-ই আসল সত্য থাকল, আর Pages একটি মাত্র সামনের দরজা। প্রক্সি `Accept`
হেডার (HTML/Markdown/JSON), API key হেডার, আর canonical লিংক — সব ফরোয়ার্ড করে।

### ঝুঁকি, লুকানো নয়

- `pages.dev` shared suffix → Google-এর কাছে authority নেই; `shouroveh9.workers.dev`-এর চেয়ে
  **ব্র্যান্ডের দিক থেকে ভালো, SEO-র দিক থেকে সমান**
- Pages free tier: মাসে ৫০০ বিল্ড, ডিপ্লয়ে ২০,০০০ ফাইল
- Pages বন্ধ হলে → Worker-এর ঠিকানা এখনো কাজ করবে (ক্যানোনিকাল বদলাতে হবে)

---

## পরবর্তী ধাপ — স্থায়ী ডোমেইন (এখনো বাকি)

ফ্রি অপশনগুলোর যাচাইকৃত চিত্র (২১ অক্টোবর, primary source থেকে):

| অপশন | ফলাফল | কারণ |
|---|---|---|
| **js.org** | ❌ **বাদ** | ToS: *"Websites must be directly related to the JavaScript ecosystem... Websites that merely use JavaScript... are not eligible"* |
| **is-a.dev** | ❌ **বাদ** | ToS §4: *"Commercial, for-profit, or political purposes"* নিষিদ্ধ |
| **eu.org** | ⚠️ **ঝুঁকিপূর্ণ** | Gmail-এ validation ব্লকড (নিজের ফর্মে লেখা) + ২০২৬-এ approval ৩ মাস–১ বছর লেগেছে (৫টি community রিপোর্ট) |
| **pp.ua** | ❌ | ইউক্রেনীয় SMS, public WHOIS, বার্ষিক renewal ঝুঁকি, reputational |
| **`dordekha.dpdns.org`** (DigitalPlat) | ✅ **সেরা বাকি অপশন** | ফ্রি, **NS delegation সম্পূর্ণ allowed**, PSL-তে আছে (মিনিট–একদিন), Cloudflare জোন হিসেবে নেয় → Worker সরাসরি সার্ভ করবে, কোনো প্রক্সি নেই |
| **`.com` / `.cc`** | 💰 আয় হলে | Cloudflare Registrar-এ at-cost ≈ $10/বছর — **স্থায়ী সমাধান** |

### DigitalPlat-এর পথ (২টি মালিক-অ্যাকশন, ১–২৪ ঘণ্টা)

1. **[dash.domain.digitalplat.org](https://dash.domain.digitalplat.org/auth/register)** — ইমেইল + GitHub OAuth দিয়ে signup
2. `dordekha.dpdns.org` রেজিস্টার করুন (PSL-তে আছে ✅, NS delegation allowed ✅)
3. **ক্লাউডফ্লেয়ারে "Add a domain"** → `dordekha.dpdns.org` → Free plan → দুটি NS কপি করুন
4. DigitalPlat প্যানেলে সেই দুটো NS বসান
5. জোন active হলে → Worker → **Settings → Domains & Routes → Add → Custom Domain** → `dordekha.dpdns.org`
6. (ঐচ্ছিক) MX রেকর্ড → ইমেইল

**সবচেয়ে ছোট পথ (আমি করতে পারি, মালিকের ২ মিনিটের কাজ):**
উপরের ৩–৬ ধাপের সব API দিয়ে করা যায় — মালিক শুধু একটি **Cloudflare API token**
(Zone:Edit + DNS:Edit + Workers:Scripts:Edit) বানিয়ে দিলেই হবে। সেই টোকেন দিলে আমি এক লাইনে
পুরোটা করে দেব:

```
node tools/setup-domain.mjs dordekha.dpdns.org <আপনার-টোকেন>
```

স্ক্রিপ্টটা জোন বানায় → NS বের করে → Worker-কে ডোমেইনে যুক্ত করে → `SITE_ORIGIN` বদলায় →
ডিপ্লয় করে → যাচাই করে।

---

## ধাপ ১ — Cloudflare API টোকেন বানান (২ মিনিট, ফ্রি)

টোকেনটা দরকার কারণ `wrangler`-এর লগইনে ডোমেইন যোগ করার permission নেই
(`Requires permission "com.cloudflare.api.account.zone.create"`)।

1. খুলুন: **https://dash.cloudflare.com/profile/api-tokens**
2. **Create Token** → **Create Custom Token**
3. ভরুন:

   | ঘর | মান |
   |---|---|
   | Token name | `dordekha-domain-setup` |
   | Permissions | **Zone** → **Edit** · **DNS** → **Edit** · **Account** → **Account Settings** → **Read** |
   | Zone Resources | Include → Specific zone → *(পরে জোন যোগ হলে)* **All zones from an account** → `dordekha` account |
   | Account Resources | Include → Specific account → `dordekha` |

4. **Continue to summary** → **Create Token**
5. **টোকেনটা কপি করে রাখুন** (একবারই দেখা যায়)।

> ⚠️ টোকেনটা কাউকে দেবেন না। শুধু আমাকে (OpenCode) দিন — আমি এখানেই ব্যবহার করে ফেলব, তারপর
> টোকেনটা মুছে দেবেন।

---

## ইমেইল (B2B আউটরেচের জন্য)

ডোমেইন বসানোর পরে ইমেইল ঠিকানা যোগ করা যাবে:

- **পাঠানোর জন্য:** Zoho Mail-এর ফ্রি প্ল্যান (কাস্টম ডোমেইন, ১ ব্যবহারকারী) অথবা
  Brevo/SendGrid-এর ফ্রি SMTP রিলে (দিনে ৩০০/১০০ পর্যন্ত) — উভয়েই ফ্রি টায়ারেই
- **গ্রহণের জন্য:** Cloudflare Email Routing (সম্পূর্ণ ফ্রি) — `contact@dordekha.pages.dev`
  আপনার Gmail-এ চলে আসবে

**⚠️ আইনি দিক:** বাংলাদেশে ট্রেড লাইসেন্স ছাড়া বাণিজ্যিক ইমেইল (বিশেষত কেনাকাটার ইমেইল) পাঠানো
ঝুঁকিপূর্ণ। লাইসেন্স চিঠি না যাওয়া পর্যন্ত **শুধু গ্রহণ**-এর পথ চালু রাখাই নিরাপদ।

---

## স্থায়ী ডোমেইনের পথে গেলে যা মনে রাখা দরকার

1. **ডোমেইন-কেন্দ্রিক কোড না লিখুন।** Sitemap, canonical, structured data, internal links,
   `robots.txt`, `llms.txt` — সব hostname-agnostic আছে ✅
2. **একাধিক ঠিকানা চলতে পারে।** একটি Worker-এ একাধিক custom domain যায়। পরে `.com` কিনলে
   সেটা যোগ করে পুরোনোটা 301 redirect করা যাবে — কোনো migration লাগবে না
3. **`workers.dev` ঠিকানাটা ভাঙবেন না** — ৫ সেকেন্ডের fallback
4. **Renewal-এর ক্যালেন্ডার রিমাইন্ডার** রাখুন (DigitalPlat: expiry-র ১২০ দিনের মধ্যে)
