import { expect, it, vi } from "vitest";
import { createTelegramBridge, splitTelegramReply, TELEGRAM_COPY, telegramConfig, type TelegramCursor } from "./private-dm.ts";

const config = {
  token: "12345678:fake_test_token_not_a_real_credential", userId: 7676, apiKey: "fake_local_key_not_a_credential_qqqq",
  endpoint: "http://127.0.0.1:8081/hooks/api/bots/assistant/telegram", stateDir: "/tmp/yarvan-telegram-test",
};
const update = (id: number, text: string, chat = "private", userId = 7676) => ({ update_id: id, message: { text, from: { id: userId, is_bot: false }, chat: { type: chat, id: userId } } });

it("fails closed on non-loopback endpoint, unexpected credentials and unsupported old servers", async () => {
  const options = { YARVAN_TELEGRAM_TOKEN: config.token, YARVAN_TELEGRAM_USER_ID: String(config.userId), YARVAN_TELEGRAM_BOT_API_KEY: config.apiKey };
  expect(() => telegramConfig({ ...options, YARVAN_TELEGRAM_BOT_API_URL: "https://not-local.example/hooks/api/bots/assistant/telegram" }, "/tmp")).toThrow();
  expect(telegramConfig({ ...options, YARVAN_TELEGRAM_BOT_API_URL: config.endpoint }, "/tmp")).toMatchObject({ endpoint: config.endpoint, userId: 7676 });
  const fake = vi.fn(async () => Response.json({ reply: "wrong server" }));
  const bridge = createTelegramBridge(config, { fetch: fake, save: () => {}, signal: new AbortController().signal });
  await expect(bridge.run({ offset: 0 })).rejects.toThrow();
  expect(fake).toHaveBeenCalledTimes(1);
});

it("accepts only the owner's DM; resumes its own thread; checks pending results and persists offset before dispatch", async () => {
  const events: Array<{ url: string; body: any }> = [];
  const saves: TelegramCursor[] = [];
  const fetcher: typeof fetch = async (target, init) => {
    const url = String(target);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    events.push({ url, body });
    if (url.startsWith("https://api.telegram.org/")) {
      expect(body.chat_id).toBe(config.userId);
      expect(JSON.stringify(body)).not.toContain(config.apiKey);
      return Response.json({ ok: true, result: {} });
    }
    expect(new Headers(init?.headers).get("x-yarvan-telegram")).toBe("private-v1");
    if (url.endsWith("?mode=telegram")) return Response.json({ telegram: "private-v1" });
    if (url.endsWith("?thread=dm-1")) return Response.json({ thread: "dm-1", reply: "پاسخ نمونه" });
    if (body.message === "needs a person") return Response.json({ thread: "dm-2", status: "needs_approval" }, { status: 202 });
    expect(saves.at(-1)?.offset).toBeGreaterThan(12);
    return Response.json({ thread: "dm-1", status: "working" }, { status: 202 });
  };
  const bridge = createTelegramBridge(config, { fetch: fetcher, save: (row) => saves.push(row), signal: new AbortController().signal, pause: async () => {} });
  await bridge.verify();
  let cursor = await bridge.processUpdate(update(10, "blocked sender", "private", 9999), { offset: 0 });
  cursor = await bridge.processUpdate(update(11, "blocked group", "group"), cursor);
  expect(events).toHaveLength(1);
  cursor = await bridge.processUpdate(update(12, "اولین پیام"), cursor);
  expect(cursor).toMatchObject({ offset: 13, thread: "dm-1" });
  expect(events.at(-1)?.body.text).toBe("پاسخ نمونه");
  cursor = await bridge.processUpdate(update(13, "پیام دوم"), cursor);
  expect(events.find((e) => e.body?.message === "پیام دوم")?.body.thread).toBe("dm-1");
  const before = events.length;
  expect(await bridge.processUpdate(update(13, "duplicate"), cursor)).toEqual(cursor);
  expect(events).toHaveLength(before);
  expect(await bridge.processUpdate(update(14, "/reset"), cursor)).toEqual({ offset: 15 });
  expect(events.at(-1)?.body.text).toBe(TELEGRAM_COPY.reset);
  const afterReset = await bridge.processUpdate(update(15, "needs a person"), { offset: 15 });
  expect(afterReset).toEqual({ offset: 16, thread: "dm-2" });
  expect(events.find((e) => e.body?.message === "needs a person")?.body.thread).toBeUndefined();
  expect(events.at(-1)?.body.text).toBe(TELEGRAM_COPY.approval);
  expect(events.some((event) => event.url.includes("/approve"))).toBe(false);
  expect(splitTelegramReply("🚀".repeat(5000)).every((part) => part.length <= 4096)).toBe(true);
});
