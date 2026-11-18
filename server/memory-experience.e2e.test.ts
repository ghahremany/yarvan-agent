// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { ReplyMemoryContext } from "../packages/phone-protocol/src/reply-memory.ts";
import type { MemorySuggestionQueue } from "../shared/memory-suggestions.ts";
import type { PinnedMemorySnapshot } from "../shared/pinned-memory.ts";
import type { BotProject, WireBot, WireMessage, WireTask } from "../shared/wire.ts";
import { CAPTURE_MARKER } from "./memory-capture.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

it.skipIf(process.platform === "win32")("scopes pins, discloses dispatched notes and keeps private chats out of the durable review flow", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-memory-experience-"));
  const routes = join(scratch, "routes.json");
  const helperPrompts = join(scratch, "helper.jsonl");
  const secretSource = "I grow sundial-orchids called AuroraTwist in the greenhouse.";
  const seenSource = "I collect blue pottery every weekend. I love pistachio gelato.";
  const approved = "The person collects blue pottery on weekends";
  const rejected = "The person loves pistachio gelato";
  writeFileSync(routes, JSON.stringify({ [CAPTURE_MARKER]: JSON.stringify([
    { text: "The person grows AuroraTwist orchids", kind: "fact", aboutUser: true, evidence: "grow sundial-orchids called AuroraTwist" },
    { text: approved, kind: "fact", aboutUser: true, evidence: "collect blue pottery every weekend" },
    { text: rejected, kind: "preference", evidence: "love pistachio gelato" },
  ]) }));
  const capabilityKey = randomUUID();
  const env = { ...process.env, OMB_TEST_INTERNAL_CAPABILITY_KEY: capabilityKey, FAKE_CLAUDE_VERSION: "2.1.306", FAKE_CLAUDE_TEXT_LOG: helperPrompts, FAKE_CLAUDE_TEXT_ROUTES: routes };
  const fixture = await launchVerificationServer(env);
  const { url, dataDir } = fixture.info;
  const dump = fixture.fixtureDumpPath;
  let restarted: ChildProcess | undefined;
  const api = async <T>(path: string, method = "GET", body?: unknown, status = 200, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const turn = async (bot: string, thread: string, text: string) => {
    rmSync(dump, { force: true });
    const target = ["--bot", bot, "--task", thread, "--url", url];
    await runControlOmb(["send", "--text", text, ...target]);
    expect(await runControlOmb(["wait", "--timeout", "30", ...target])).toMatchObject({ status: "settled" });
    return JSON.parse(readFileSync(dump, "utf8")) as { pid: number; argv: string[]; prompt: unknown; systemPrompt: string; settings: unknown; mcpConfig: unknown };
  };
  const messages = (thread: string) => api<{ messages: WireMessage[] }>(`/api/threads/${thread}/messages`);
  const bundled = (dispatched: Awaited<ReturnType<typeof turn>>) => dispatched.systemPrompt + "\n" + JSON.stringify(dispatched.prompt);

  try {
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Memo" }, 201);
    const base = `/api/bots/${bot.id}`;
    const mint = async (threadId: string) => {
      const { token } = await api<{ token: string }>("/api/testing/internal-capability", "POST", { botId: bot.id, threadId }, 201,
        { "x-openmausbot-test-capability": capabilityKey });
      return { authorization: `Bearer ${token}` };
    };
    const pinPath = `${base}/memory/pinned`;
    const queuePath = `${base}/memory/suggestions`;
    const pins = await api<PinnedMemorySnapshot>(pinPath);
    const project = async (name: string) => (await api<{ project: BotProject }>(`${base}/projects`, "POST", { name }, 201)).project;
    const narvan = await project("Narvan");
    const anaar = await project("Anaar");
    const task = async (body: object) => (await api<{ task: WireTask }>(`${base}/tasks`, "POST", body, 201)).task;
    const scoped = await task({ projectId: narvan.id });
    const unrelated = await task({ projectId: anaar.id });
    const notebook = () => api<{ text: string }>(`${base}/memory/file?path=MEMORY.md`);
    const replyPath = (thread: string, message: string) => `${base}/tasks/${thread}/replies/${message}/memory`;
    await api(base, "PATCH", { memoryUpkeep: false });
    await api("/api/config", "PUT", { memory: { captureQuietMs: 1_000 }, profile: { aboutMe: "PROFILE-CHARTREUSE" } });
    await api(`${base}/memory/file`, "PUT", { path: "MEMORY.md", text: "- Stable notebook fact QUASAR-INDEX\n" });
    await api(`${base}/memory/file`, "PUT", { path: "memory/dining.md", text: "---\ntitle: Dining\naliases: [restaurants]\n---\n- REMEMBERED-SAFFRON in restaurants\n" });
    const global = { id: randomUUID(), title: "Global", text: "ALL-ROOMS-POMELO" };
    const pin = { id: randomUUID(), title: "Narvan", text: "ONLY-NARVAN-INDIGO", projectId: narvan.id };
    await api(pinPath, "PUT", { ...pins, blocks: [{ ...pin, projectId: "not-this-bot" }] }, 400);
    const saved = await api<PinnedMemorySnapshot>(pinPath, "PUT", { ...pins, blocks: [pin, global] });
    const first = await turn(bot.id, scoped.threadId, "For restaurants, reply with just: okay");
    for (const value of [pin.text, global.text, "QUASAR-INDEX", "PROFILE-CHARTREUSE", "REMEMBERED-SAFFRON"]) expect(bundled(first)).toContain(value);
    const reply = (await messages(scoped.threadId)).messages.findLast((line) => line.role === "bot" && line.kind === "text")!;
    expect(reply.hasMemoryContext).toBe(true);
    expect(JSON.stringify(reply)).not.toContain(pin.text); // Only the flag travels with the transcript.
    const disclosed = await api<ReplyMemoryContext>(replyPath(scoped.threadId, reply.id));
    expect(disclosed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "pin", pinId: pin.id, text: pin.text }),
      expect.objectContaining({ kind: "notebook", file: "MEMORY.md", text: expect.stringContaining("QUASAR-INDEX") }),
      expect.objectContaining({ kind: "recall", file: "memory/dining.md", text: expect.stringContaining("REMEMBERED-SAFFRON") }),
      expect.objectContaining({ kind: "profile", text: "PROFILE-CHARTREUSE" }),
    ]));
    await api(replyPath(unrelated.threadId, reply.id), "GET", undefined, 404);
    const { task: fork } = await api<{ task: WireTask }>(`${base}/tasks/${scoped.threadId}/forks`, "POST", { messageId: reply.id }, 201);
    expect((await messages(fork.threadId)).messages.every((line) => !line.hasMemoryContext)).toBe(true);
    await api(replyPath(fork.threadId, reply.id), "GET", undefined, 404);
    expect(bundled(await turn(bot.id, unrelated.threadId, "Reply with just: okay"))).not.toContain(pin.text);
    const pinV2 = { ...pin, text: "ONLY-NARVAN-SECOND" };
    await api(pinPath, "PUT", { ...saved, blocks: [pinV2, global] });
    expect(await api(replyPath(scoped.threadId, reply.id))).toEqual(disclosed);
    await api(`${base}/tasks/${scoped.threadId}`, "PATCH", { projectId: anaar.id });
    const moved = await turn(bot.id, scoped.threadId, "Reply with just: moved");
    expect(moved.argv).not.toContain("--resume");
    expect(bundled(moved)).not.toContain(pin.text);
    expect(bundled(moved)).not.toContain(pinV2.text);

    await api(queuePath, "PUT", { enabled: true });
    await api(base, "PATCH", { memoryUpkeep: true });
    const privateTask = await task({ memoryOff: true, projectId: narvan.id });
    expect(privateTask.memoryOff).toBe(true);
    await api(`${base}/tasks/${privateTask.threadId}`, "PATCH", { memoryOff: false }, 400);
    await api(`${base}/compact`, "POST", { threadId: privateTask.threadId }, 409);
    const off = await turn(bot.id, privateTask.threadId, `${secretSource} Reply with just: private`);
    for (const value of [global.text, pinV2.text, "QUASAR-INDEX", "PROFILE-CHARTREUSE", "session_search"]) expect(bundled(off)).not.toContain(value);
    expect(off.argv).toContain("--no-session-persistence");
    expect(off.argv).not.toContain("--resume");
    expect(off.argv[off.argv.indexOf("--tools") + 1]).toBe("");
    expect(off.argv[off.argv.indexOf("--setting-sources") + 1]).toBe("");
    expect(off.mcpConfig).toEqual({ mcpServers: {} });
    expect(off.settings).toMatchObject({ disableAllHooks: true, autoMemoryEnabled: false, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } });
    const next = await turn(bot.id, privateTask.threadId, "Reply with just: second");
    expect(next.pid).not.toBe(off.pid);
    expect(bundled(next)).toContain(secretSource);
    expect(bundled(next)).not.toContain(global.text);
    const privateReply = (await messages(privateTask.threadId)).messages.findLast((line) => line.role === "bot" && line.kind === "text")!;
    const privateFork = await api<{ task: WireTask }>(`${base}/tasks/${privateTask.threadId}/forks`, "POST", { messageId: privateReply.id }, 201);
    expect(privateFork.task.memoryOff).toBe(true);
    expect(await api(replyPath(privateTask.threadId, privateReply.id))).toEqual({ mode: "off", items: [] });
    await api("/api/internal/threads", "GET", undefined, 403, await mint(privateTask.threadId));
    const regular = await task({});
    const ordinary = await turn(bot.id, regular.threadId, `${seenSource} Do we know of sundial-orchids? Reply with just: okay`);
    expect(bundled(ordinary)).not.toContain("AuroraTwist");
    expect(bundled(ordinary)).toContain(global.text);
    const access = await mint(regular.threadId);
    const params = `fromBotId=${bot.id}&fromThreadId=${regular.threadId}`;
    expect(await api(`/api/internal/session-search?${params}&q=AuroraTwist`, "GET", undefined, 200, access)).toMatchObject({ hits: [], memoryHits: [] });
    await api(`/api/internal/session-read?${params}&threadId=${privateTask.threadId}&messageId=${privateReply.id}`, "GET", undefined, 404, access);
    const listed = await api<{ threads: Array<{ threadId: string }> }>("/api/internal/threads", "GET", undefined, 200, access);
    expect(listed.threads.map((row) => row.threadId)).not.toContain(privateTask.threadId);
    await api("/api/internal/memory", "POST", { action: "append", text: "BLOCKED-EARLY-WRITE" }, 403, access);
    await api("/api/internal/memory/log", "POST", { text: "BLOCKED-EARLY-LOG" }, 403, access);
    await api("/api/internal/team-memory", "POST", { name: "Blocked before team memory save" }, 403, access);
    await expect.poll(async () => (await api<MemorySuggestionQueue>(queuePath)).pending.length, { timeout: 20_000 }).toBe(2);
    const queue = await api<MemorySuggestionQueue>(queuePath);
    expect(queue.pending.find((item) => item.text === approved)).toMatchObject({ quote: "I collect blue pottery every weekend.", threadId: regular.threadId });
    expect(JSON.stringify(queue)).not.toContain("AuroraTwist");
    expect(readFileSync(helperPrompts, "utf8")).not.toContain("AuroraTwist");
    expect((await notebook()).text).not.toContain(approved);
    expect((await notebook()).text).not.toContain("BLOCKED-EARLY-WRITE");
    expect(await api("/api/profile/learned")).toMatchObject({ learned: [] });

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      env: verificationServerEnvironment(env, dataDir, Number(new URL(url).port)), stdio: "ignore",
    });
    await expect.poll(() => fetch(`${url}/api/health`).then((response) => response.ok, () => false), { timeout: 20_000 }).toBe(true);
    expect(await api(queuePath)).toEqual(queue);
    expect((await api<{ bot: WireBot }>(base)).bot.tasks?.find((candidate) => candidate.threadId === privateTask.threadId)?.memoryOff).toBe(true);
    expect(await api(replyPath(scoped.threadId, reply.id))).toEqual(disclosed);
    await api(queuePath, "POST", { id: queue.pending.find((item) => item.text === approved)!.id, decision: "approve" });
    await api(queuePath, "POST", { id: queue.pending.find((item) => item.text === rejected)!.id, decision: "reject" });
    expect(await api(queuePath)).toEqual({ enabled: true, pending: [] });
    const finalNotes = (await notebook()).text;
    expect(finalNotes).toContain(approved);
    expect(finalNotes).not.toContain(rejected);
    expect(finalNotes).not.toContain("AuroraTwist");
    expect(await api("/api/profile/learned")).toMatchObject({ learned: [] });
    await api(`${base}/tasks/delete`, "POST", { threadIds: [scoped.threadId] });
    await api(replyPath(scoped.threadId, reply.id), "GET", undefined, 404);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    await removeTempDir(scratch);
  }
}, 105_000);
