# MCP Registry ও Anthropic Connectors-এ প্রকাশ — এক পাতার নির্দেশনা

> **এটি মালিকের একটি কাজ, আর মাত্র ১৫ মিনিটের।** আমি সব প্রস্তুত করে রেখেছি;
> শুধু GitHub-এর দুটি জায়গায় নাম বসাতে হবে।

---

## কেন এটা সবচেয়ে বড় লিভারেজ

আমাদের সবচেয়ে বড় সম্পদ হলো **AI সহকারীরা আমাদের উদ্ধৃতি করুক**। আর সহকারীরা
যে সার্ভারগুলো তাদের টুলবক্সে রাখে, সেগুলো তারা **রেজিস্ট্রি ও ডিরেক্টরি** থেকে
খোঁজে। আমাদের MCP server ইতিমধ্যেই চালু, keyless, এবং প্রতিটি ফলাফলে
উদ্ধৃতিযোগ্য URL দেয় — যা বাকি সব ধাপের চাবিকাঠি।

---

## ধাপ ১ — GitHub (৫ মিনিট)

1. <https://github.com/new> → রিপোজিটরি খুলুন, নাম দিন **`dordekha`**, **Public** করুন।
2. `server.json`-এ দুটি জায়গায় নাম বসান:
   - `name` → `io.github.আপনার_গিটহাব_ইউজারনেম/dordekha`
   - `repository.url` → `https://github.com/আপনার_গিটহাব_ইউজারনেম/dordekha`
3. রিপোজিটরিতে পুরো কোড তুলুন:

   ```powershell
   cd C:\Power of AI\dordekha
   git remote add origin https://github.com/আপনার_গিটহাব_ইউজারনেম/dordekha.git
   git push -u origin main
   ```

4. `README.md`-তে যে MCP ইনস্ট্রাকশন লাইন আছে, সেটা যাচাই করুন:

   ```
   opencode mcp add dordekha --url https://dordekha.shouroveh9.workers.dev/mcp
   ```

   এছাড়া Claude Desktop / Claude Code-এর জন্য:
   ```json
   { "mcpServers": { "dordekha": { "type": "http", "url": "https://dordekha.shouroveh9.workers.dev/mcp" } } }
   ```

---

## ধাপ ২ — MCP Registry (৫ মিনিট)

Registry ডাউনলোড: <https://github.com/modelcontextprotocol/registry>

```powershell
# ১. Node.js লাগবে (আছে)
npm install -g @modelcontextprotocol/registry-cli   # নাম প্রকাশে হতে পারে — README দেখুন
# ২. GitHub দিয়ে লগইন
mcp-publisher login
# ৩. রিপোজিটরির রুটে থাকা server.json দিয়ে প্রকাশ
mcp-publisher publish
```

**যা হবে:** Registry আপনার `name` নেমস্পেসের মালিকানা যাচাই করবে (GitHub দিয়ে)।
`remotes`-এর URL-এর মালিকানা Registry যাচাই করে না — ঠিক আছে, কারণ URL-টা
workers.dev-এ।

> **একটা টিপ:** `io.github.<user>/<name>` নেমস্পেসে প্রকাশ করলে কোনো ডোমেইনের
> দরকার নেই — টাকা লাগে না। পরে `.cc` ডোমেইন কিনলে (আয় হলে) নাম বদলে
> `com.<ডোমেইন>/dordekha` করা যাবে; তখন DNS দিয়ে ওনারশিপ প্রমাণ করতে হবে।

---

## ধাপ ৩ — Anthropic Connectors Directory (৫ মিনিট)

- <https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors>
- Connector-এর জন্য একটি **OAuth** বা সরল **API key** লাগে। যেহেতু আমাদের
  পাবলিক অংশ keyless, প্রথমে "No authentication"-এর পথে জমা দেওয়া যায় —
  যদি তাদের ফরম তা না চায়, তাহলে একটি মাত্র read-only API key যোগ করতে হবে
  (পেইড টায়ারের কাজ; ফ্রি টায়ারে করা যায়)।

---

## ধাপ ৪ — যাচাই (২ মিনিট)

প্রকাশের পর:

```powershell
# Registry-তে ঢুকেছে কি না
curl https://registry.modelcontextprotocol.io/v0/servers?search=dordekha

# আমাদের server.json সত্যিই কাজ করে কি না
curl -X POST https://dordekha.shouroveh9.workers.dev/mcp `
  -H "Content-Type: application/json" `
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"server/discover\"}"
```

---

## 📌 টপ-মডেলকে দেওয়ার জন্য ছোট নোট

এই চারটি ধাপের প্রথমটি (GitHub) মানুষের হাতে — বাকি তিনটি যন্ত্র করতে পারে।
তাই **টপ-মডেলকে বলুন:** "server.json প্রস্তুত আছে, README-তে ইনস্ট্রাকশন লাইন
আছে; যা করা যায় নিজে করো, আর GitHub অ্যাকাউন্ট লাগলে সেটুকু আমাকে বলো।"

---

## ⚠️ যা ভুলে যাবেন না

- **ফ্রি-পাবলিক অংশ থেকে টাকা নেওয়া বন্ধ আছে** (লাইসেন্স না পাওয়া পর্যন্ত)।
  Registry-তে প্রকাশ করলে টাকা আসবে না — এটি **উদ্ধৃতির চ্যানেল**।
- **একটি ফলাফলেও ভুল তারিখ বা ভুল সংখ্যা নয়** — এটাই রেজিস্ট্রির পরও সবচেয়ে
  বড় ঝুঁকি। একবার ভুল উদ্ধৃতি AI-র ক্যাশে গেলে সেটা চিরকাল থাকে।
- প্রকাশের পরও **`/health` ও ক্রন চালু আছে কি না** দেখবেন — ডিস্ট্রিবিউশন
  ঠিক থাকলে ক্রনও ঠিক থাকে।
