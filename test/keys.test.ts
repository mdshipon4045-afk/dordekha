import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  checkAccess,
  currentPeriod,
  enforceAccess,
  generateApiKey,
  hashApiKey,
  keyFromRequest,
  planLimits,
  type LicenseRecord,
} from "../src/keys";
import type { Env } from "../src/types";
import { fakeD1, fakeKV } from "./helpers/fake-env";

/**
 * The paid tier, first slice: an API key, a quota and a usage view.
 *
 * The data is free, so what is sold is the service around it — a key, a
 * guaranteed quota, a record of what was used. The machinery has to exist
 * before the licence arrives, because selling needs something to sell.
 */

function licence(over: Partial<LicenseRecord> = {}): LicenseRecord {
  return {
    id: "lic_test",
    keyHash: "hash",
    plan: "api",
    label: "Test",
    contact: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: null,
    active: true,
    callsUsed: 10,
    callsLimit: 1000,
    // The counter belongs to the month the calls were made in.
    period: currentPeriod(new Date("2026-10-21T00:00:00.000Z")),
    ...over,
  };
}

describe("the key itself", () => {
  it("is long enough that guessing it is hopeless", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    // 32 random bytes, base64url encoded.
    expect(key.length).toBeGreaterThanOrEqual(API_KEY_PREFIX.length + 40);
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey()));
    expect(keys.size).toBe(200);
  });

  it("is stored only as a hash", async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
    // The same key always hashes the same; a different one never does.
    expect(await hashApiKey(key)).toBe(hash);
    expect(await hashApiKey(generateApiKey())).not.toBe(hash);
  });

  it("is read from the header a client actually sends", () => {
    const bearer = new Request("https://x.test", { headers: { Authorization: "Bearer dk_abc" } });
    expect(keyFromRequest(bearer)).toBe("dk_abc");

    const xkey = new Request("https://x.test", { headers: { "X-API-Key": "dk_def" } });
    expect(keyFromRequest(xkey)).toBe("dk_def");

    expect(keyFromRequest(new Request("https://x.test"))).toBeNull();
  });

  it("ignores a header that carries something else", () => {
    const req = new Request("https://x.test", { headers: { Authorization: "Bearer not-a-key" } });
    expect(keyFromRequest(req)).toBeNull();
  });
});

describe("what each plan allows", () => {
  it("gives the free plan a small quota and no commercial right", () => {
    const free = planLimits("free");
    expect(free.monthlyQuota).toBeGreaterThan(0);
    expect(free.requiresLicence).toBe(false);
  });

  it("makes the paid plans need the data licence", () => {
    for (const plan of ["commercial", "api", "enterprise"]) {
      expect(planLimits(plan).requiresLicence).toBe(true);
    }
  });

  it("gives a bigger plan a bigger quota", () => {
    expect(planLimits("api").monthlyQuota).toBeGreaterThan(planLimits("free").monthlyQuota);
    expect(planLimits("enterprise").monthlyQuota).toBe(0); // unlimited
  });

  it("treats an unknown plan as the free one", () => {
    expect(planLimits("nonsense").monthlyQuota).toBe(planLimits("free").monthlyQuota);
  });
});

describe("whether a licence may be used", () => {
  it("lets a live licence through", () => {
    const decision = checkAccess(licence(), new Date("2026-10-21T00:00:00.000Z"));
    expect(decision.ok).toBe(true);
  });

  it("refuses an expired licence", () => {
    const decision = checkAccess(
      licence({ expiresAt: "2026-10-01T00:00:00.000Z" }),
      new Date("2026-10-21T00:00:00.000Z"),
    );
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  it("refuses a licence that was switched off", () => {
    const decision = checkAccess(licence({ active: false }), new Date("2026-10-21T00:00:00.000Z"));
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  it("refuses a licence that has used up its quota", () => {
    const decision = checkAccess(
      licence({ callsUsed: 1000, callsLimit: 1000 }),
      new Date("2026-10-21T00:00:00.000Z"),
    );
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(429);
  });

  it("never refuses an unlimited licence for quota", () => {
    const decision = checkAccess(
      licence({ callsUsed: 10_000_000, callsLimit: 0 }),
      new Date("2026-10-21T00:00:00.000Z"),
    );
    expect(decision.ok).toBe(true);
  });

  it("starts a new month with a fresh allowance", () => {
    // The allowance is per calendar month, so a counter from October says
    // nothing about November.
    const decision = checkAccess(
      licence({ callsUsed: 1000, callsLimit: 1000, period: "2026-10" }),
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(decision.ok).toBe(true);
  });
});

describe("enforcing access on a request", () => {
  function envFor(lic: LicenseRecord | null) {
    const d1 = fakeD1([
      (sql) =>
        sql.includes("FROM license")
          ? {
              results: lic
                ? [
                    {
                      id: lic.id,
                      key_hash: lic.keyHash,
                      plan: lic.plan,
                      label: lic.label,
                      contact: lic.contact,
                      created_at: lic.createdAt,
                      expires_at: lic.expiresAt,
                      active: lic.active ? 1 : 0,
                      calls_used: lic.callsUsed,
                      calls_limit: lic.callsLimit,
                      period: lic.period,
                    },
                  ]
                : [],
            }
          : null,
    ]);
    const kv = fakeKV();
    return { env: { DB: d1.db, CACHE: kv.kv } as unknown as Env, d1, kv };
  }

  it("lets an anonymous request through — the citation surface must not break", async () => {
    const { env } = envFor(null);
    const decision = await enforceAccess(env, new Request("https://x.test/api/v1/latest"), "/api/v1/latest", "api");
    expect(decision.ok).toBe(true);
    expect(decision.licence).toBeNull();
    expect(decision.status).toBe(200);
  });

  it("refuses a key that does not exist", async () => {
    const { env } = envFor(null);
    const req = new Request("https://x.test/api/v1/latest", { headers: { "X-API-Key": generateApiKey() } });
    const decision = await enforceAccess(env, req, "/api/v1/latest", "api");
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  it("refuses a key whose licence is over its quota", async () => {
    const { env } = envFor(licence({ callsUsed: 1000, callsLimit: 1000 }));
    const req = new Request("https://x.test/api/v1/latest", { headers: { "X-API-Key": generateApiKey() } });
    const decision = await enforceAccess(env, req, "/api/v1/latest", "api");
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(429);
  });

  it("lets a live key through and says which licence it is", async () => {
    const { env } = envFor(licence());
    const req = new Request("https://x.test/api/v1/latest", { headers: { "X-API-Key": generateApiKey() } });
    const decision = await enforceAccess(env, req, "/api/v1/latest", "api");
    expect(decision.ok).toBe(true);
    expect(decision.licence?.plan).toBe("api");
  });
});
