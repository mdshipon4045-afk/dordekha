/**
 * Telling the search engines that these URLs exist.
 *
 * A site with no external links is not found by being crawled — it is
 * found by being pointed at. IndexNow is the protocol for that: a URL
 * notification to the engines that accept it, with no account and no
 * cost.
 *
 * What it does and does not do:
 *   - Bing, Yandex, Seznam and the engines that follow them accept it,
 *     and the URLs go into their crawl queue at once.
 *   - **Google does not accept it.** Google finds a new site through
 *     links, and through Search Console. So this is the half of
 *     discoverability that costs nothing, not the whole of it.
 *
 * The key proves ownership: the engine fetches the key file from the
 * host before it accepts a notification. The file is served by the Worker
 * so the key can stay a secret rather than sitting in the repository.
 */

import type { Env } from "./types";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export interface IndexNowPayload {
  host: string;
  key: string;
  urlList: string[];
}

/**
 * The notification, or `null` when there is nothing to say.
 *
 * A URL that is not ours is left out: the protocol rejects a list that
 * contains another host's URLs, and one bad URL would lose the whole
 * batch.
 */
export function buildIndexNowPayload(env: Env, urls: string[]): IndexNowPayload | null {
  const key = env.INDEXNOW_KEY;
  if (!key) return null;
  const host = hostOf(env.SITE_ORIGIN);
  if (!host) return null;

  const seen = new Set<string>();
  const urlList: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.host !== host) continue;
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());
    urlList.push(url.toString());
  }
  if (urlList.length === 0) return null;
  return { host, key, urlList };
}

export interface IndexNowResult {
  sent: boolean;
  status: number | null;
  count: number;
  error?: string;
}

/**
 * Send the notification.
 *
 * A refusal is reported, not thrown: a search engine being unhappy must
 * never break an ingest.
 */
export async function notifyIndexNow(env: Env, urls: string[]): Promise<IndexNowResult> {
  const payload = buildIndexNowPayload(env, urls);
  if (!payload) return { sent: false, status: null, count: 0 };

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return {
      sent: res.status === 200 || res.status === 202,
      status: res.status,
      count: payload.urlList.length,
    };
  } catch (err) {
    return {
      sent: false,
      status: null,
      count: payload.urlList.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
