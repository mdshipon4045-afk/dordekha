/**
 * Telegram publishing.
 *
 * The channel is the only push channel in the product: it is free, it does
 * not need a paid API, and Telegram is used in Bangladesh for exactly this
 * kind of business/alert feed.
 *
 * Two things matter for how a daily price message is written:
 *
 *  1. It must not imply a change that was not reported. More than half of
 *     the upstream rows are carried forward from the previous day, so a
 *     message that says "পেঁয়াজ বেড়েছে" when the value was simply copied
 *     is a lie. Carried-forward rows are labelled as such.
 *  2. It must be readable in a chat app — short lines, Bangla numerals, the
 *     unit spelled out, and a link to the full table.
 */

import type { Env } from "./types";
import { formatBdt } from "./normalize";
import { toBanglaDigits } from "./normalize";

export interface TelegramConfig {
  token: string;
  /**
   * The channel to post to. Either a numeric chat id (e.g. "-1004442758387")
   * or a public username (e.g. "@dordekha_bazar").
   *
   * The numeric id is preferred: a channel's username can be changed or
   * mistyped, and a wrong username fails with the unhelpful "chat not
   * found". The id is stable for the life of the channel.
   */
  channel: string;
}

export interface DigestRow {
  commodityBn: string;
  districtBn: string;
  retail: { min: number | null; max: number | null; avg: number | null; unitBn: string } | null;
  wholesale: { avg: number | null } | null;
  carriedForward: boolean;
}

export interface DigestInput {
  date: string;
  rows: DigestRow[];
  origin: string;
  sourceName: string;
  /** Headline commodities to feature, in order. */
  featured: string[];
}

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfig(env: Env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  const channel = env.TELEGRAM_CHANNEL;
  if (!token || !channel) return null;
  return { token, channel };
}

async function tg(config: TelegramConfig, method: string, body: unknown): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    return { ok: json.ok === true, description: json.description };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  }
}

/** Verify the token, that the bot can reach the channel, and its rights. */
export async function checkTelegram(config: TelegramConfig): Promise<{
  bot: string;
  channel: string;
  ok: boolean;
  error?: string;
  rights?: { status: string; canPost: boolean };
}> {
  const me = await tg(config, "getMe", {});
  const chat = await tg(config, "getChat", { chat_id: config.channel });

  const meBody = await tgRaw(config, "getMe", {});
  const botName = meBody?.username ?? "bot";

  if (!me.ok) return { bot: botName, channel: config.channel, ok: false, error: me.description };
  if (!chat.ok) return { bot: botName, channel: config.channel, ok: false, error: chat.description };

  const member = await tgRaw(config, "getChatMember", { chat_id: config.channel, user_id: meBody?.id });
  const status = member?.status ?? "unknown";
  const canPost = member?.can_post_messages === true;

  return {
    bot: botName,
    channel: config.channel,
    ok: status === "administrator" || status === "creator",
    error: status === "administrator" || status === "creator" ? undefined : `bot status is "${status}"`,
    rights: { status, canPost },
  };
}

/** Raw Telegram call, returning the parsed result or null. */
async function tgRaw(config: TelegramConfig, method: string, body: unknown): Promise<any> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; result?: unknown };
    return json.ok ? json.result : null;
  } catch {
    return null;
  }
}

/** Send a message to the channel. */
export async function sendToChannel(config: TelegramConfig, text: string, parseMode: "HTML" | "MarkdownV2" = "HTML"): Promise<boolean> {
  const res = await tg(config, "sendMessage", {
    chat_id: config.channel,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: false,
  });
  if (!res.ok) console.error("telegram send failed:", res.description);
  return res.ok;
}

/**
 * Build the daily digest.
 *
 * A message is only allowed to claim a movement for a row that was freshly
 * reported; carried-forward rows are shown with an explicit marker.
 */
export function buildDigest(input: DigestInput): string {
  const { date, rows, origin, sourceName, featured } = input;

  const byCommodity = new Map<string, DigestRow[]>();
  for (const r of rows) {
    const list = byCommodity.get(r.commodityBn) ?? [];
    list.push(r);
    byCommodity.set(r.commodityBn, list);
  }

  const lines: string[] = [];
  lines.push(`<b>আজকের বাজারদর — ${toBanglaDigits(date)}</b>`);
  lines.push("");

  const ordered = [...featured, ...[...byCommodity.keys()].filter((k) => !featured.includes(k))];
  let shown = 0;

  for (const name of ordered) {
    const list = byCommodity.get(name);
    if (!list || list.length === 0) continue;
    if (shown >= 8) break;
    shown++;

    const fresh = list.filter((r) => !r.carriedForward && r.retail?.avg != null);
    const carried = list.filter((r) => r.carriedForward);

    const best = (fresh.length ? fresh : list).slice().sort((a, b) => (b.retail?.avg ?? 0) - (a.retail?.avg ?? 0))[0];
    if (!best) continue;

    const unit = best.retail?.unitBn ?? "কেজি";
    const range =
      best.retail?.min != null && best.retail?.max != null && best.retail.max !== best.retail.min
        ? `${formatBdt(best.retail.min)}–${formatBdt(best.retail.max)}`
        : formatBdt(best.retail?.avg);

    const district = best.districtBn;
    const wholesale = best.wholesale?.avg != null ? ` · পাইকারি ${formatBdt(best.wholesale.avg)}` : "";
    const mark = fresh.length === 0 ? " <i>(আগের দিনের মান)</i>" : "";

    lines.push(`• <b>${escapeHtml(name)}</b> — ${district} ${range} টাকা/${escapeHtml(unit)}${wholesale}${mark}`);
  }

  if (shown === 0) {
    lines.push("আজকের রিপোর্টে এখনো কোনো তথ্য নেই।");
  }

  lines.push("");
  lines.push(`<i>উৎস: ${escapeHtml(sourceName)}</i>`);
  lines.push(`<a href="${origin}/">সব জেলার দর দেখুন</a> · <a href="${origin}/verify">যেকোনো দাবি যাচাই করুন</a>`);

  return lines.join("\n");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Publish the digest. Returns false when Telegram is not configured. */
export async function publishDigest(env: Env, input: DigestInput): Promise<{ sent: boolean; error?: string }> {
  const config = telegramConfig(env);
  if (!config) return { sent: false, error: "Telegram is not configured" };
  const text = buildDigest(input);
  const ok = await sendToChannel(config, text);
  return ok ? { sent: true } : { sent: false, error: "sendMessage failed" };
}
