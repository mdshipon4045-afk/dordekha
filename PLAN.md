# দরদেখা (Dordekha) — Build Plan & Status

> Bangladesh official market-price ground-truth service. AI-native, zero-budget, self-operating.
> Owner: AI agent (build + operate). Human needed only for: account creation/login, payment
> confirmation, one weekly Facebook-group post, and signing the data-licence letter.

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (needs human) · `[-]` dropped (with reason)

---

## Phase 0 — Verify (no accounts needed)
- [x] **G1** Data acquisition: official MOA JSON API found, keyless, 64 dist × 505 upazila × 447 commodity
- [x] Master dropdowns shape verified (8 div / 64 dist / 505 upazila / 357 market / 447 commodity)
- [x] Daily price report: 93–97 rows/district/day; date gaps confirmed (2026-10-16, 10-10 → 0 rows)
- [x] **Unit bug found**: upstream "quintal" is actually **per 100 kg**. `w/100` → per-kg sits below retail ✓
- [x] `district_id: []` ≠ all districts → must iterate 64 districts explicitly (61/64 have data)
- [x] National scroll endpoint confirmed as fallback
- [x] **Research**: Google AIO −58% CTR ⇒ B2C-page plan dead; AI-citation + MCP/API is the live path
- [x] **Research**: no self-serve crawl-payment rail; Google pilot invite-only; Perplexity by nomination
- [x] **Research**: MCP 2026-07-28 is **stateless** (no initialize handshake) → easy in a Worker
- [x] **Research**: licence-not-data is the proven model (Open-Meteo, OpenCorporates, OpenSanctions)
- [x] **Research**: Bangladesh Copyright Act 2023 §28 → government data is *not* public domain in BD

## Phase 1 — Core engine ✅ **COMPLETE**
- [x] Project scaffold: TS + Vitest 4 + Wrangler 4.151, git initialised
- [x] `src/units.ts` — unit normalisation: measured factor table + arithmetic derivation + plausibility repair
- [x] `src/normalize.ts` — Bangla numerals, carry-forward detection, anomaly flags
- [x] `src/bn.ts` — Bengali nukta folding (decomposed vs precomposed) + match scoring
- [x] `src/resolve.ts` — name → commodity/district resolution, ambiguity reporting, coverage tie-break
- [x] `src/moa.ts` — upstream client (retry, timeout, no cookies/CSRF)
- [x] `migrations/0001_init.sql` — D1 schema (price_daily, price_latest, ingest_run, license, usage, alerts, content_page)
- [x] `src/ingest.ts` — self-chaining cron job (10 ms CPU budget on the free plan)
- [x] `src/db.ts` — D1 access layer, chunked upsert under the bound-parameter limit
- [x] `src/api.ts` behaviour in `src/index.ts` — REST: /latest, /price, /series.csv, /districts, /commodities
- [x] `src/render.ts` — server-rendered Bangla HTML, per-fact permalinks, JSON-LD Dataset
- [x] Content negotiation: `Accept: text/markdown` / `application/json`, `Vary: Accept`, `.md` / `.json` sibling URLs
- [x] `src/mcp.ts` — MCP JSON-RPC: `server/discover`, `tools/list`, `tools/call`; every result carries a citable `url`
- [x] `/robots.txt` — allow search bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot…), block training bots
- [x] `/llms.txt`, `/sitemap.xml`, `/health`, `/verify`
- [x] Tests: **33 unit tests** + **53 end-to-end checks**, all green
- [x] Docs: `README.md`, `docs/DATASET.md`, `docs/DEPLOY-BN.md`

### Measured findings from the live pipeline
- 11,603 rows for 3 report days (64 districts)
- **53.89% of rows are carry-forwards** — upstream copies the previous day's figure more than half the time. Charts must not imply movement that was not reported.
- 1 unit-pair group needed a repair (54 rows), 15 rows could not be verified at all — both are labelled, never hidden.

## Phase 2 — Deployment (needs 1 account) 🔥 **BLOCKED ON HUMAN**
- [!] Cloudflare account + login → deploy Worker, create D1 + KV, set cron → **`docs/DEPLOY-BN.md`**
- [ ] Domain (from revenue): `.cc` ≈ $8 at Cloudflare Registrar; `eu.org` free subdomain as stopgap
- [ ] Telegram bot token + channel @username
- [ ] GitHub repo for source + backup

## Phase 3 — Distribution (all autonomous once deployed)
- [ ] MCP Registry publish · Anthropic Connectors Directory · ChatGPT App Directory
- [ ] `index.parallel.ai` enrolment · Perplexity `publishers@perplexity.ai`
- [ ] Cloudflare Pay Per Use (Ceramic.ai / You.com) + Stripe Connect
- [ ] `data.gov.bd` listing · Wikidata item · Bangla Wikipedia (needs 1 independent secondary source)
- [ ] Search Console + "Search generative AI features" opt-in
- [ ] Audit Cloudflare AI Crawl Control defaults (Sept 15 2026 default blocks Googlebot on ad pages)
- [ ] B2B cold-outreach autopilot (40–100 prospects, personalised Bangla)
- [ ] Telegram daily digest + price-threshold alerts

## Phase 4 — Monetisation
- [ ] Lemon Squeezy store (global) + bKash merchant (BD) + Payoneer
- [ ] Licence keys + server-side metering (MCP `x-mcp-header` SEP-2243)
- [ ] Tiers: free · commercial licence ৳2–8k/mo · API $49–199/mo · alerts ৳500–1k/mo · bulk export one-off
- [ ] Proprietary layer: index, volatility, cross-district spread, anomaly detection

## Gates (must pass before building the paid tier)
- [ ] **G-0.5a Citation Proof** — a real AI assistant cites us with a clickable link
- [ ] **G-0.5b Licence** — DAM/ডিসিম written data licence or defensible derivative position
- [ ] **G-0.5c Buyer** — ≥1 customer pays

## Kill switch
If 6 months pass with <3 paying customers ⇒ wind down cleanly, export data, keep the open dataset.

---

## Human action checklist
(only these; everything else is the agent's job)
1. [ ] **Create a Cloudflare account** → `docs/DEPLOY-BN.md` step 1  ← *start here*
2. [ ] Telegram: BotFather token + channel @username
3. [ ] bKash personal number (for receiving payments)
4. [ ] Sign + send the DAM/ডিসিম data-licence letter (agent drafts it)
5. [ ] One Facebook-group post per week (agent writes the text)
6. [ ] Confirm 2–5 incoming payments per month (agent lists amount + txn id)
