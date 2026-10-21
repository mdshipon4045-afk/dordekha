/**
 * The Pages front for দরদেখা.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Worker lives at `dordekha.shouroveh9.workers.dev`. That hostname
 * carries the owner's personal account name, and every AI citation points
 * at it. A citation is this product's only asset, so it has to read like
 * the product: `dordekha.pages.dev`.
 *
 * A Cloudflare Pages project named `dordekha` gets exactly that hostname,
 * free, and `pages.dev` is on the Public Suffix List — so search engines
 * treat it as a site of its own rather than a page of somebody else's.
 *
 * WHY A PROXY AND NOT A MOVE
 * -------------------------
 * The Worker holds D1, KV and the per-minute cron that keeps the prices
 * fresh. Pages Functions have no cron, and moving the whole application
 * would mean two copies of the truth. So the Worker stays the truth and
 * this file is a thin front: it forwards the request and hands back the
 * answer, headers and all.
 *
 * What must survive the hop: the `Accept` header (the site serves HTML,
 * Markdown or JSON depending on it), the API key headers, and the response
 * headers that carry the provenance — `Content-Type`, `Cache-Control`,
 * `ETag`, `Link` and the canonical.
 */

const ORIGIN = "https://dordekha.shouroveh9.workers.dev";

/** Request headers that change the answer and so must be forwarded. */
const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "accept-encoding",
  "x-api-key",
  "authorization",
  "content-type",
  "user-agent",
];

/** Response headers that carry the provenance and so must come back. */
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-language",
  "cache-control",
  "etag",
  "last-modified",
  "link",
  "location",
  "vary",
  "x-robots-tag",
  "content-signal",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, ORIGIN);

    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    let response;
    try {
      response = await fetch(target.toString(), init);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Service temporarily unavailable",
          status: "degraded",
          message: "এই মুহূর্তে তথ্য দেওয়া যাচ্ছে না। সাময়িক সমস্যা হলে কিছুক্ষণ পরে আবার চেষ্টা করুন।",
          retry_after_seconds: 60,
        }),
        { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    const out = new Headers();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) out.set(name, value);
    }
    // The body is the Worker's; the cache is the Worker's too, so the edge
    // does not need a second opinion about it.
    out.set("x-dordekha-front", "pages");

    return new Response(response.body, { status: response.status, headers: out });
  },
};
