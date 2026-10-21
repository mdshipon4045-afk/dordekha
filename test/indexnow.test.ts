import { describe, expect, it, vi } from "vitest";
import { buildIndexNowPayload, notifyIndexNow } from "../src/indexnow";
import type { Env } from "../src/types";

/**
 * Telling the search engines that the URLs exist.
 *
 * A site with no external links is not found by being crawled — it is
 * found by being pointed at. IndexNow is the protocol for that: a URL
 * notification to the engines that accept it, with no account and no
 * cost. Google does not accept it, so this is not the whole answer, but
 * it is the half that costs nothing.
 */

function envWith(key: string | undefined, origin = "https://dordekha.shouroveh9.workers.dev") {
  return {
    SITE_ORIGIN: origin,
    INDEXNOW_KEY: key,
  } as unknown as Env;
}

describe("the IndexNow notification", () => {
  it("names the host, the key and the URLs", () => {
    const payload = buildIndexNowPayload(envWith("abc123def456"), [
      "https://dordekha.shouroveh9.workers.dev/price/onion/dhaka/2026-10-19",
    ]);
    expect(payload.host).toBe("dordekha.shouroveh9.workers.dev");
    expect(payload.key).toBe("abc123def456");
    expect(payload.urlList).toHaveLength(1);
  });

  it("says nothing when there is no key", () => {
    const payload = buildIndexNowPayload(envWith(undefined), ["https://x.test/a"]);
    expect(payload).toBeNull();
  });

  it("leaves out a URL that is not ours", () => {
    const payload = buildIndexNowPayload(envWith("abc123def456"), [
      "https://dordekha.shouroveh9.workers.dev/price/onion/dhaka/2026-10-19",
      "https://someone.else/page",
    ]);
    expect(payload?.urlList).toHaveLength(1);
  });

  it("posts to the shared endpoint and reports the status", async () => {
    const fetchMock = vi.fn(async () => new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifyIndexNow(envWith("abc123def456"), [
      "https://dordekha.shouroveh9.workers.dev/price/onion/dhaka/2026-10-19",
    ]);

    expect(result.sent).toBe(true);
    expect(result.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("indexnow");
    expect(String(init?.method ?? "")).toBe("POST");
    expect(String(init?.body)).toContain("dordekha.shouroveh9.workers.dev");
  });

  it("reports a refusal instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 })),
    );
    const result = await notifyIndexNow(envWith("abc123def456"), [
      "https://dordekha.shouroveh9.workers.dev/price/onion/dhaka/2026-10-19",
    ]);
    expect(result.sent).toBe(false);
    expect(result.status).toBe(403);
  });

  it("does nothing at all without a key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await notifyIndexNow(envWith(undefined), ["https://x.test/a"]);
    expect(result.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
