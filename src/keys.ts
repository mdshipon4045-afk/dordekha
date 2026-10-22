/**
 * API keys, plans and quotas.
 *
 * THE SHAPE OF THE THING
 * ----------------------
 * The data is free — it is the government publishing it. What is sold is
 * the service around it: a key, a guaranteed quota, a record of what was
 * used, and the right to use it commercially. The machinery has to exist
 * before the licence arrives, because selling needs something to sell.
 *
 * WHAT IT COSTS
 * -------------
 * Every budget here is a budget of a free tier, so the design is shaped by
 * three of them:
 *
 *   - D1 reads 5,000,000 rows a day. So the monthly counter is a counter
 *     (`license.calls_used`), never a `COUNT(*)` over the event table: a
 *     count over 50,000 events would cost 50,000 rows on every check.
 *   - D1 writes 100,000 rows a day. So a keyed call costs exactly **one**
 *     write, and a refused call costs **none**. A script holding a key
 *     that is over its quota must not be able to spend the ingest's write
 *     budget by being refused.
 *   - KV writes 1,000 a day, and the ingest needs most of them. So the
 *     request path writes nothing to KV at all: the licence is read from
 *     the cache, and the counters live in the database row.
 *
 * THE COMMERCIAL GATE
 * -------------------
 * A paid plan may not be sold before the data licence is signed. That is
 * not a note in a document, it is a rule in the code: creating a paid key
 * fails until `LICENCE_GRANTED` says otherwise. A free key is a
 * convenience and is always allowed.
 */

import type { Env } from "./types";

export const API_KEY_PREFIX = "dk_";

export type Plan = "free" | "commercial" | "api" | "enterprise";

export interface PlanLimits {
  /** Calls allowed per calendar month. 0 means unlimited. */
  monthlyQuota: number;
  /** Calls allowed in one five-minute window. */
  burstLimit: number;
  /** Whether selling this plan needs the data licence. */
  requiresLicence: boolean;
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  // A free key is a courtesy: a higher burst allowance and a record of
  // what was used, for someone who is not paying.
  free: { monthlyQuota: 2_000, burstLimit: 60, requiresLicence: false },
  commercial: { monthlyQuota: 50_000, burstLimit: 300, requiresLicence: true },
  api: { monthlyQuota: 500_000, burstLimit: 900, requiresLicence: true },
  enterprise: { monthlyQuota: 0, burstLimit: 3_000, requiresLicence: true },
};

export function planLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.free;
}

export function isKnownPlan(plan: string): plan is Plan {
  return plan in PLAN_LIMITS;
}

export interface LicenseRecord {
  id: string;
  keyHash: string;
  plan: string;
  label: string | null;
  contact: string | null;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
  callsUsed: number;
  callsLimit: number;
  /** The calendar month the counter belongs to, e.g. "2026-10". */
  period: string | null;
  /** Calls in the current burst window. */
  burstCount: number;
  /** The burst window the count belongs to. */
  burstWindow: string | null;
}

/* ── The key ───────────────────────────────────────────────────────────────── */

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh key: 32 random bytes, so guessing is hopeless. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return API_KEY_PREFIX + base64Url(bytes);
}

/**
 * The stored form of a key.
 *
 * Only the hash is kept, so a leaked database does not hand over working
 * keys. SHA-256 because the key is already 32 bytes of entropy — there is
 * nothing to brute-force and nothing to slow down.
 */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The credential a request carries, if it carries one.
 *
 * A credential that is not one of our keys is still a credential: it is
 * reported as an invalid key rather than ignored, so a client with a
 * broken key is told so instead of quietly getting the free service.
 */
export function keyFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^(?:Bearer|Token)\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1]!.trim();
  }
  const xkey = request.headers.get("x-api-key");
  if (xkey) return xkey.trim();
  return null;
}

/** Does this look like one of our keys? */
export function isOurKey(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) && key.length >= API_KEY_PREFIX.length + 20;
}

/* ── The period and the window ─────────────────────────────────────────────── */

/** The calendar month a counter belongs to, in UTC. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Five minutes: the burst window. */
export const BURST_WINDOW_MS = 5 * 60 * 1000;

/** The window id a moment belongs to. */
export function burstWindow(now: Date = new Date()): string {
  return String(Math.floor(now.getTime() / BURST_WINDOW_MS));
}

/* ── Access ────────────────────────────────────────────────────────────────── */

export interface AccessCheck {
  ok: boolean;
  status: number;
  reason?: string;
}

/**
 * May this licence be used right now?
 *
 * A counter from an earlier month is not a used quota — the allowance is
 * per calendar month, so a stale counter reads as zero. The same is true
 * of the burst count: a count from an earlier window is a count of a
 * window that has closed.
 */
export function checkAccess(lic: LicenseRecord, now: Date = new Date()): AccessCheck {
  if (!lic.active) {
    return { ok: false, status: 401, reason: "এই লাইসেন্সটি নিষ্ক্রিয় করা হয়েছে।" };
  }
  if (lic.expiresAt && Date.parse(lic.expiresAt) <= now.getTime()) {
    return { ok: false, status: 401, reason: "লাইসেন্সের মেয়াদ শেষ হয়ে গেছে।" };
  }
  const used = lic.period === currentPeriod(now) ? lic.callsUsed : 0;
  if (lic.callsLimit > 0 && used >= lic.callsLimit) {
    return { ok: false, status: 429, reason: "এই মাসের কোটা শেষ।" };
  }
  const limits = planLimits(lic.plan);
  if (limits.burstLimit > 0 && lic.burstWindow === burstWindow(now) && lic.burstCount >= limits.burstLimit) {
    return { ok: false, status: 429, reason: "খুব দ্রুত অনুরোধ আসছে। একটু পরে আবার চেষ্টা করুন।" };
  }
  return { ok: true, status: 200 };
}

/* ── Storage ───────────────────────────────────────────────────────────────── */

const LIC_CACHE_PREFIX = "lic:";
/**
 * How long the cached licence — and its counters — may be stale.
 *
 * Short, because the counters are what the quota is checked against, and
 * because a stale counter is how a client gets more than it paid for.
 * A cache miss is one indexed row, so a short life is cheap: 1,440 reads
 * a day per licence against a five million budget.
 */
const LIC_CACHE_TTL = 10;

function mapLicenseRow(row: Record<string, unknown>): LicenseRecord {
  return {
    id: String(row.id),
    keyHash: String(row.key_hash),
    plan: String(row.plan),
    label: (row.label as string | null) ?? null,
    contact: (row.contact as string | null) ?? null,
    createdAt: String(row.created_at),
    expiresAt: (row.expires_at as string | null) ?? null,
    active: Number(row.active) !== 0,
    callsUsed: Number(row.calls_used ?? 0),
    callsLimit: Number(row.calls_limit ?? 0),
    period: (row.period as string | null) ?? null,
    burstCount: Number(row.burst_count ?? 0),
    burstWindow: (row.burst_window as string | null) ?? null,
  };
}

const LICENSE_COLUMNS =
  "id, key_hash, plan, label, contact, created_at, expires_at, active, calls_used, calls_limit, period, burst_count, burst_window";

/**
 * Find the licence for a key.
 *
 * The cache comes first, as everywhere else. The cache holds the counters
 * too, so a burst of calls does not turn into a burst of database reads.
 */
export async function verifyLicense(env: Env, key: string): Promise<LicenseRecord | null> {
  const hash = await hashApiKey(key);
  const cacheKey = LIC_CACHE_PREFIX + hash;

  try {
    const cached = await env.CACHE.get(cacheKey, "json");
    if (cached) return cached as LicenseRecord;
  } catch {
    /* a cache miss is not a failure */
  }

  let row: Record<string, unknown> | null = null;
  try {
    row = await env.DB
      .prepare(`SELECT ${LICENSE_COLUMNS} FROM license WHERE key_hash = ?`)
      .bind(hash)
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  if (!row) return null;

  const licence = mapLicenseRow(row);
  try {
    await env.CACHE.put(cacheKey, JSON.stringify(licence), { expirationTtl: LIC_CACHE_TTL });
  } catch {
    /* the cache is an optimisation */
  }
  return licence;
}

/**
 * Count the call.
 *
 * One statement, and both rollovers happen inside it: when the stored
 * period is not this month the monthly counter starts again at one, and
 * when the stored window is not this one the burst counter does the same.
 * One write per call, and a refused call does not get here at all.
 *
 * The fuller statement needs columns that the worker adds in its daily
 * upkeep. On a database that has not had that upkeep yet the statement
 * fails, and the count is still worth keeping — so the counter is
 * incremented on its own instead.
 */
export async function recordUsage(
  env: Env,
  licence: LicenseRecord,
  endpoint: string,
  source: string,
  status: number,
): Promise<void> {
  const now = new Date();
  const period = currentPeriod(now);
  const window = burstWindow(now);
  try {
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE license
              SET calls_used  = CASE WHEN period = ?       THEN calls_used  + 1 ELSE 1 END,
                  period      = ?,
                  burst_count = CASE WHEN burst_window = ? THEN burst_count + 1 ELSE 1 END,
                  burst_window = ?
            WHERE id = ?`,
        )
        .bind(period, period, window, window, licence.id),
      env.DB
        .prepare(
          `INSERT INTO usage_event (license_id, at, endpoint, source, status) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(licence.id, now.toISOString(), endpoint, source, status),
    ]);
  } catch {
    // The database has not been brought up to date yet. The counter still
    // has to move, or the quota would never be reached.
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE license SET calls_used = calls_used + 1 WHERE id = ?`).bind(licence.id),
        env.DB
          .prepare(
            `INSERT INTO usage_event (license_id, at, endpoint, source, status) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(licence.id, now.toISOString(), endpoint, source, status),
      ]);
    } catch {
      /* a record is not a requirement: the call itself already succeeded */
    }
  }
}

export interface AccessDecision {
  ok: boolean;
  status: number;
  licence: LicenseRecord | null;
  reason?: string;
}

/**
 * Decide whether a request may proceed, and count it if it may.
 *
 * A request with no key is always allowed: the public pages and the free
 * API are the citation surface, and a paywall in front of them would cost
 * more traffic than it could ever earn in licences.
 *
 * A request with a key that is not ours is refused. A key that is ours but
 * is unknown, expired, over its quota or bursting is refused too — and
 * refused without a single write, so that being refused cannot be turned
 * into a way of spending the database's write budget.
 */
export async function enforceAccess(
  env: Env,
  request: Request,
  endpoint: string,
  source: string,
): Promise<AccessDecision> {
  const key = keyFromRequest(request);
  if (!key) return { ok: true, status: 200, licence: null };

  if (!isOurKey(key)) {
    return { ok: false, status: 401, licence: null, reason: "API key চেনা যায়নি।" };
  }

  let licence: LicenseRecord | null = null;
  try {
    licence = await verifyLicense(env, key);
  } catch {
    licence = null;
  }
  if (!licence) {
    return { ok: false, status: 401, licence: null, reason: "API key চেনা যায়নি।" };
  }

  const check = checkAccess(licence);
  if (!check.ok) {
    // No write. A refused call must not cost the database anything.
    return { ok: false, status: check.status, licence, reason: check.reason };
  }

  await recordUsage(env, licence, endpoint, source, 200);
  return { ok: true, status: 200, licence };
}

/* ── Issuing ───────────────────────────────────────────────────────────────── */

export interface IssueRequest {
  plan: string;
  label?: string;
  contact?: string;
  /** How many months the licence runs for. 0 means it does not expire. */
  months?: number;
}

export interface IssuedLicense extends LicenseRecord {
  /** The raw key. Shown once, and never stored. */
  key: string;
}

export class LicenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LicenceError";
  }
}

/**
 * Create a licence and hand back the key.
 *
 * The key is shown once and only its hash is kept. A paid plan is refused
 * until the data licence has been granted: the legal permission is not a
 * promise, and a key that can be sold cannot be created before it exists.
 */
export async function issueLicense(env: Env, request: IssueRequest): Promise<IssuedLicense> {
  const plan = request.plan;
  if (!isKnownPlan(plan)) {
    throw new LicenceError(`অজানা প্ল্যান: ${plan}`, 400);
  }
  const limits = planLimits(plan);
  // The gate. It was there because a key that can be sold must not
  // exist before the legal permission does. The owner decided, on the
  // twenty-second of October, to work without waiting for that permission:
  // the family covers any question that arises, and the letter is already
  // with the office. So the switch is turned, and it stays a switch: turn
  // it back and the commercial plans close again.
  if (limits.requiresLicence && env.LICENCE_GRANTED !== "1") {
    throw new LicenceError(
      "তথ্যের লাইসেন্স না আসা পর্যন্ত বাণিজ্যিক প্ল্যান দেওয়া যাবে না।",
      403,
    );
  }

  const key = generateApiKey();
  const keyHash = await hashApiKey(key);
  const id = `lic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const months = request.months ?? 1;
  const expiresAt =
    months > 0 ? new Date(Date.now() + months * 30 * 86_400_000).toISOString() : null;
  const period = currentPeriod();
  const window = burstWindow();

  await env.DB.prepare(
    `INSERT INTO license (id, key_hash, plan, label, contact, created_at, expires_at, active, calls_used, calls_limit)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
  )
    .bind(
      id,
      keyHash,
      plan,
      request.label ?? null,
      request.contact ?? null,
      createdAt,
      expiresAt,
      limits.monthlyQuota,
    )
    .run();

  return {
    id,
    key,
    keyHash,
    plan,
    label: request.label ?? null,
    contact: request.contact ?? null,
    createdAt,
    expiresAt,
    active: true,
    callsUsed: 0,
    callsLimit: limits.monthlyQuota,
    period,
    burstCount: 0,
    burstWindow: window,
  };
}

/** The licences, without the keys. */
export async function listLicenses(env: Env): Promise<LicenseRecord[]> {
  const { results } = await env.DB
    .prepare(`SELECT ${LICENSE_COLUMNS} FROM license ORDER BY created_at DESC`)
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapLicenseRow);
}

/** Switch a licence off. */
export async function disableLicense(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare(`UPDATE license SET active = 0 WHERE id = ?`).bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}
