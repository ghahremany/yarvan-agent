// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { expect, it, vi } from "vitest";
import { CAPTURE_MARKER } from "./memory-capture.ts";
import { DREAM_MARKER } from "./memory-dream.ts";
import { decideMemorySuggestion, enqueueMemorySuggestions, memorySuggestions, setMemoryReview, sourceSentence } from "./memory-suggestions.ts";
import { createMemoryUpkeep } from "./memory-upkeep.ts";
import { readMemoryFile, writeMemoryFile } from "./workspace.ts";

const now = new Date("2026-11-18T08:00:00.000Z");
const date = () => now;
const allow = { now, canApprove: () => true };

it("keeps quotes from the actual conversation and suppresses re-proposing a rejected fact", () => {
  const id = "review-reject";
  const quote = sourceSentence("play the cello", ["Hello! I play the cello on Sundays. That is all."]);
  expect(quote).toBe("I play the cello on Sundays.");
  expect(sourceSentence("never said this", [quote!])).toBeUndefined();
  const fact = { text: "The person plays cello on Sundays", quote: quote!, threadId: "thread", via: "capture" as const };
  expect(enqueueMemorySuggestions(id, [fact], now)).toBe(0);
  setMemoryReview(id, true);
  expect(enqueueMemorySuggestions(id, [fact, fact], now)).toBe(1);
  const queue = memorySuggestions(id);
  expect(queue.pending).toHaveLength(1);
  expect(queue.pending[0]).toMatchObject(fact);
  expect(decideMemorySuggestion(id, queue.pending[0]!.id, "reject", allow)).toMatchObject({ ok: true, queue: { pending: [] } });
  expect(enqueueMemorySuggestions(id, [fact], now)).toBe(0);
  expect(readMemoryFile(id).text).toBe("");
});

it("doesn't overwrite a notebook changed after a proposed replacement", () => {
  const id = "review-stale";
  setMemoryReview(id, true);
  writeMemoryFile(id, "- 2026-10-29 · Lives in Pune\n");
  expect(enqueueMemorySuggestions(id, [{ text: "Lives in Delhi", replaces: "Lives in Pune", quote: "I live in Delhi.", threadId: "thread", via: "dream" }], now)).toBe(1);
  const suggestion = memorySuggestions(id).pending[0]!;
  writeMemoryFile(id, "- 2026-11-17 · Lives in Mumbai\n");
  expect(decideMemorySuggestion(id, suggestion.id, "approve", allow)).toMatchObject({ ok: false, status: 409 });
  expect(readMemoryFile(id).text).not.toContain("Delhi");
  expect(memorySuggestions(id).pending).toEqual([suggestion]);
  writeMemoryFile(id, "- 2026-10-29 · Lives in Pune\n");
  expect(decideMemorySuggestion(id, suggestion.id, "approve", allow)).toMatchObject({ ok: true, queue: { pending: [] } });
  expect(readMemoryFile(id).text).toContain("~~Lives in Pune~~");
  expect(readMemoryFile(id).text).toContain("Lives in Delhi");
});

it("queues capture and dream facts with evidence rather than writing to memory or About me", async () => {
  const bot = { id: "review-upkeep", name: "Notes" };
  setMemoryReview(bot.id, true);
  writeMemoryFile(bot.id, "- 2026-11-15 · The person drinks tea\n");
  const source = "I like espresso in the morning. I like dark roast coffee.";
  const addToAboutMe = vi.fn(() => 0);
  const generateText = vi.fn(async (prompt: string) => {
    if (prompt.includes(CAPTURE_MARKER)) return JSON.stringify([
      { text: "The person likes morning espresso", kind: "preference", evidence: "like espresso in the morning", aboutUser: true },
      { text: "Not written in the chat", kind: "outcome", evidence: "Made up source" },
    ]);
    if (prompt.includes(DREAM_MARKER)) return JSON.stringify({
      learned: [{ text: "The person likes dark roast coffee", from: [1, 2], aboutUser: true, evidence: ["I like dark roast coffee", "I like dark roast coffee"], confidence: 0.95 }],
      outdated: [{ line: 0, now: "The person no longer drinks tea", from: [2], evidence: ["I no longer drink tea"], confidence: 0.95 }],
    });
    throw new Error("Review shouldn't invoke organize or a contradiction check");
  });
  const upkeep = createMemoryUpkeep({
    bot: () => bot, bots: () => [bot], busy: () => false, sourceLabel: () => "chat", addToAboutMe,
    engine: () => ({ generateText }), review: () => true, enqueueSuggestions: enqueueMemorySuggestions,
    mayCapture: (_botId, threadId) => threadId !== "private",
    conversations: () => [
      { threadId: "main", lines: [{ by: "person", text: source }] },
      { threadId: "other", lines: [{ by: "person", text: "I like dark roast coffee. I no longer drink tea." }] },
      { threadId: "private", lines: [{ by: "person", text: "NO-MEMORY-THREAD-MARKER" }] },
    ],
    now: date, quietMs: () => 1_000, tidyHour: () => 5,
  });
  expect(await upkeep.capture({ botId: bot.id, threadId: "private", turns: [{ person: "Private words that must never leave this chat", bot: "Okay" }] }))
    .toMatchObject({ added: 0, note: "this conversation no longer feeds the bot's memory" });
  expect(generateText).not.toHaveBeenCalled();
  expect(await upkeep.capture({ botId: bot.id, threadId: "main", turns: [{ person: source, bot: "Okay" }] })).toMatchObject({ added: 0, suggested: 1, aboutMe: 0 });
  expect(await upkeep.dream(bot.id)).toMatchObject({ conversations: 2, suggested: 2, learned: [], outdated: [], aboutMe: 0 });
  expect(generateText.mock.calls.flat()).not.toEqual(expect.arrayContaining([expect.stringContaining("NO-MEMORY-THREAD-MARKER")]));
  expect(memorySuggestions(bot.id).pending).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: "The person likes morning espresso", quote: "I like espresso in the morning.", threadId: "main", via: "capture" }),
    expect.objectContaining({ text: "The person likes dark roast coffee", quote: "I like dark roast coffee.", threadId: "main", via: "dream" }),
    expect.objectContaining({ text: "The person no longer drinks tea", replaces: "The person drinks tea", quote: "I no longer drink tea.", threadId: "other" }),
  ]));
  expect(readMemoryFile(bot.id).text).toBe("- 2026-11-15 · The person drinks tea\n");
  expect(addToAboutMe).not.toHaveBeenCalled();
});

it("re-checks review and source eligibility after waiting for the helper model", async () => {
  const bot = { id: "review-in-flight", name: "Notes" };
  let review = false, eligible = true;
  const sources = "I practice violin on Monday.";
  let finish!: (text: string) => void;
  const result = new Promise<string>((resolve) => { finish = resolve; });
  const addToAboutMe = vi.fn(() => 0);
  const upkeep = createMemoryUpkeep({
    bot: () => bot, bots: () => [bot], busy: () => false, sourceLabel: () => "chat", addToAboutMe,
    engine: () => ({ generateText: () => result }), review: () => review, enqueueSuggestions: enqueueMemorySuggestions,
    mayCapture: () => eligible, now: date, quietMs: () => 1_000, tidyHour: () => 5,
  });
  const capturing = upkeep.capture({ botId: bot.id, threadId: "main", turns: [{ person: sources, bot: "Okay" }] });
  review = true; eligible = false;
  setMemoryReview(bot.id, true);
  finish(JSON.stringify([{ text: "The person practices violin every Monday", kind: "fact", evidence: sources, aboutUser: true }]));
  expect(await capturing).toMatchObject({ added: 0 });
  expect(memorySuggestions(bot.id).pending).toEqual([]);
  expect(addToAboutMe).not.toHaveBeenCalled();
});

it("does not file an expired or no longer permitted suggestion", () => {
  const id = "review-expiry";
  setMemoryReview(id, true);
  enqueueMemorySuggestions(id, [{ text: "The person is in Madrid this week", quote: "I am in Madrid this week.",
    threadId: "madrid", via: "capture", until: "2026-11-18" }], now);
  const item = memorySuggestions(id).pending[0]!;
  expect(decideMemorySuggestion(id, item.id, "approve", { ...allow, canApprove: () => false })).toMatchObject({ ok: false, status: 409 });
  expect(decideMemorySuggestion(id, item.id, "approve", { ...allow, now: new Date("2026-11-20T08:00:00.000Z") })).toMatchObject({ ok: false, status: 409 });
  expect(memorySuggestions(id).pending).toEqual([item]);
  expect(readMemoryFile(id).text).toBe("");
});

it.each([false, true])("never files a capture automatically when review is %s at its start and toggles in flight", async (initial) => {
  const bot = { id: `review-commit-${initial}`, name: "Notes" };
  let review = initial;
  setMemoryReview(bot.id, review);
  const source = "I practice violin on Mondays.";
  let finish!: (text: string) => void;
  const result = new Promise<string>((resolve) => { finish = resolve; });
  const addToAboutMe = vi.fn(() => 0);
  const upkeep = createMemoryUpkeep({
    bot: () => bot, bots: () => [bot], busy: () => false, sourceLabel: () => "chat", addToAboutMe,
    engine: () => ({ generateText: () => result }), review: () => review, enqueueSuggestions: enqueueMemorySuggestions,
    now: date, quietMs: () => 1_000, tidyHour: () => 5,
  });
  const capturing = upkeep.capture({ botId: bot.id, threadId: "main", turns: [{ person: source, bot: "Okay" }] });
  // Let the queued capture take its initial review snapshot before changing it.
  await new Promise((resolve) => setImmediate(resolve));
  review = !initial;
  setMemoryReview(bot.id, review);
  finish(JSON.stringify([{ text: "The person practices violin on Mondays", kind: "fact", evidence: source, aboutUser: true }]));
  expect(await capturing).toMatchObject({ added: 0, suggested: review ? 1 : 0, aboutMe: 0 });
  expect(memorySuggestions(bot.id).pending).toHaveLength(review ? 1 : 0);
  expect(readMemoryFile(bot.id).text).not.toContain("violin");
  expect(addToAboutMe).not.toHaveBeenCalled();
});
