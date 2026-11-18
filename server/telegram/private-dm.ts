import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";
import { readPrivateJson } from "../private-workspace-json.ts";
import { redactSecretsInText } from "../redact.ts";

const ID = /^[\w-]{1,128}$/;
const apiAuth = "x-yarvan-telegram";
const mode = "private-v1";
const MAX_INBOUND = 16_000;
export const TELEGRAM_COPY = {
  hello: "یاروان آماده است. پیام متنی بفرست. /reset گفت‌وگوی تازه شروع می‌کند.",
  reset: "گفت‌وگوی تازه شروع شد؛ تاریخچهٔ قبلی در یاروان پاک نشده است.",
  refused: "یاروان نتوانست پیام را پردازش کند. تنظیمات اتصال و بات را در یاروان بررسی کن.",
  noReply: "یاروان هنوز پاسخ متنی آماده نکرده. نتیجه را در برنامه بررسی کن.",
  approval: "این درخواست نیاز به بررسی در خود یاروان دارد.",
} as const;

export interface TelegramConfig { token: string; userId: number; apiKey: string; endpoint: string; stateDir: string }
export interface TelegramCursor { offset: number; thread?: string }
const cursorSchema = z.strictObject({ offset: z.number().int().nonnegative(), thread: z.string().regex(ID).optional() });
const updateSchema = z.object({ update_id: z.number().int().nonnegative(), message: z.object({
  from: z.object({ id: z.number().int(), is_bot: z.boolean() }), chat: z.object({ id: z.number().int(), type: z.string() }),
  text: z.string().max(MAX_INBOUND), sender_chat: z.unknown().optional(), via_bot: z.unknown().optional(),
}).optional().catch(undefined) });
const replySchema = z.union([
  z.object({ thread: z.string().regex(ID), reply: z.string().max(1_000_000) }),
  z.object({ thread: z.string().regex(ID), status: z.enum(["working", "needs_approval"]) }),
]);

export function telegramConfig(env: Record<string, string | undefined>, dataDir: string): TelegramConfig {
  const token = env.YARVAN_TELEGRAM_TOKEN?.trim() ?? "";
  const user = env.YARVAN_TELEGRAM_USER_ID?.trim() ?? "";
  const apiKey = env.YARVAN_TELEGRAM_BOT_API_KEY?.trim() ?? "";
  let url: URL;
  try { url = new URL(env.YARVAN_TELEGRAM_BOT_API_URL?.trim() ?? ""); } catch { throw new Error("Set the loopback YARVAN_TELEGRAM_BOT_API_URL."); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash ||
    !/^\/hooks\/api\/bots\/[\w-]{1,128}\/telegram$/.test(url.pathname)) throw new Error("Telegram uses only the local Bot API receiver on 127.0.0.1.");
  if (!/^\d{5,20}:[\w-]{25,100}$/.test(token) || !/^[1-9]\d{0,15}$/.test(user) || !Number.isSafeInteger(Number(user)) || !/^[\w-]{20,180}$/.test(apiKey)) {
    throw new Error("Set the Telegram token, numeric owner ID and ordinary Bot API key.");
  }
  return { token, userId: Number(user), apiKey, endpoint: url.href, stateDir: join(dataDir, "telegram") };
}

export function acquireTelegramCursor(config: TelegramConfig) {
  const d = lstatSync(config.stateDir, { throwIfNoEntry: false });
  if (d && !d.isDirectory()) throw new Error("Telegram state must be a real directory.");
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(config.token.split(":")[0]!).digest("hex").slice(0, 24);
  const lock = join(config.stateDir, `${key}.lock`);
  const path = join(config.stateDir, `${key}.json`);
  const bind = createHash("sha256").update(JSON.stringify([config.userId, config.endpoint])).digest("hex");
  const descriptor = openSync(lock, "wx", 0o600);
  const release = () => { closeSync(descriptor); unlinkSync(lock); };
  try {
    const raw = readPrivateJson(path, 4096);
    const saved = raw === undefined ? undefined : z.object({ scope: z.string(), cursor: cursorSchema }).parse(raw);
    const cursor: TelegramCursor = saved ? { ...saved.cursor, ...(saved.scope !== bind ? { thread: undefined } : {}) } : { offset: 0 };
    return { cursor, save: (next: TelegramCursor) => writeFileAtomic(path, JSON.stringify({ scope: bind, cursor: cursorSchema.parse(next) }), { mode: 0o600 }), release };
  } catch (error) { release(); throw error; }
}

async function jsonBounded(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_200_000) throw new Error("Telegram bridge response is too large.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

export function splitTelegramReply(text: string): string[] {
  const chars = Array.from(text.trim());
  const out: string[] = [];
  for (let i = 0; i < chars.length && i < 10_800; i += 1800) out.push(chars.slice(i, i + 1800).join(""));
  if (chars.length > 10_800) out[out.length - 1] += "\n…";
  return out;
}

export function createTelegramBridge(config: TelegramConfig, deps: {
  fetch?: typeof fetch; save(cursor: TelegramCursor): void; signal: AbortSignal;
  pause?(ms: number): Promise<unknown>; log?(): void;
}) {
  const fetcher = deps.fetch ?? fetch;
  const pause = deps.pause ?? ((ms: number) => sleep(ms, undefined, { signal: deps.signal }));
  const signal = (ms: number) => AbortSignal.any([deps.signal, AbortSignal.timeout(ms)]);
  async function telegram(method: "getUpdates" | "sendMessage", input: object) {
    const res = await fetcher(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), redirect: "error", signal: signal(method === "getUpdates" ? 34_000 : 12_000),
    });
    if (!res.ok) { await res.body?.cancel(); throw new Error("Telegram request failed."); }
    const payload = z.object({ ok: z.literal(true), result: z.unknown() }).parse(await jsonBounded(res));
    return payload.result;
  }
  async function request(body?: object, query = "") {
    return fetcher(config.endpoint + query, { method: body ? "POST" : "GET", redirect: "error", signal: signal(body ? 30_000 : 12_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}`, [apiAuth]: mode },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function send(text: string): Promise<void> {
    for (const part of splitTelegramReply(text)) await telegram("sendMessage", { chat_id: config.userId, text: part, link_preview_options: { is_disabled: true } });
  }
  async function processUpdate(raw: unknown, cursor: TelegramCursor): Promise<TelegramCursor> {
    const checked = updateSchema.safeParse(raw);
    if (!checked.success || checked.data.update_id < cursor.offset || checked.data.update_id >= Number.MAX_SAFE_INTEGER) return cursor;
    const message = checked.data.message;
    let next: TelegramCursor = { ...cursor, offset: checked.data.update_id + 1 };
    deps.save(next);
    if (!message || message.from.is_bot || message.sender_chat || message.via_bot || message.chat.type !== "private" ||
      message.from.id !== config.userId || message.chat.id !== config.userId || !message.text.trim()) return next;
    const text = message.text.trim();
    if (/^\/(?:start|help)$/i.test(text)) { await send(TELEGRAM_COPY.hello).catch(() => {}); return next; }
    if (/^\/reset$/i.test(text)) {
      next = { offset: next.offset };
      deps.save(next); await send(TELEGRAM_COPY.reset).catch(() => {}); return next;
    }
    if (text.startsWith("/")) { await send(TELEGRAM_COPY.hello).catch(() => {}); return next; }
    try {
      const payload = { message: text, wait: 12, ...(next.thread ? { thread: next.thread } : {}) };
      let response = await request(payload);
      if (response.status === 404 && next.thread) {
        await response.body?.cancel();
        next = { offset: next.offset }; deps.save(next);
        response = await request({ message: text, wait: 12 });
      }
      if (!response.ok) { await response.body?.cancel(); await send(TELEGRAM_COPY.refused); return next; }
      let result = replySchema.parse(await jsonBounded(response));
      next = { offset: next.offset, thread: result.thread }; deps.save(next);
      for (let at = 0; at < 12 && "status" in result && result.status === "working"; at++) {
        await pause(3200);
        const poll = await request(undefined, `?thread=${encodeURIComponent(next.thread!)}`);
        if (!poll.ok) { await poll.body?.cancel(); break; }
        const later = replySchema.parse(await jsonBounded(poll));
        if (later.thread !== next.thread) throw new Error("Unexpected thread.");
        result = later;
      }
      if ("reply" in result) await send(redactSecretsInText(result.reply) || TELEGRAM_COPY.noReply);
      else if (result.status === "needs_approval") await send(TELEGRAM_COPY.approval);
      else await send(TELEGRAM_COPY.noReply);
    } catch {
      if (!deps.signal.aborted) await send(TELEGRAM_COPY.refused).catch(() => {});
    }
    return next;
  }
  async function verify(): Promise<void> {
    const res = await request(undefined, "?mode=telegram");
    if (!res.ok) { await res.body?.cancel(); throw new Error("Local Telegram mode refused."); }
    z.object({ telegram: z.literal(mode) }).parse(await jsonBounded(res));
  }
  async function run(initial: TelegramCursor) {
    await verify();
    let state = initial;
    let retries = 0;
    while (!deps.signal.aborted) {
      try {
        const rows = z.array(z.unknown()).max(30).parse(await telegram("getUpdates", { offset: state.offset, limit: 30, timeout: 24, allowed_updates: ["message"] }));
        for (const row of rows) {
          if (deps.signal.aborted) break;
          state = await processUpdate(row, state);
        }
        retries = 0;
      } catch {
        if (deps.signal.aborted) break;
        deps.log?.();
        await pause(Math.min(30_000, 1500 * 2 ** Math.min(5, retries++))).catch(() => {});
      }
    }
  }
  return { processUpdate, verify, run };
}
