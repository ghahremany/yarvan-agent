import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { CAPTURE_MARKER } from "./memory-capture.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import type { BotProject, WireBot, WireMessage, WireTask } from "../shared/wire.ts";
import type { ProjectMemorySnapshot } from "../shared/project-memory.ts";
import type { PinnedMemorySnapshot } from "../shared/pinned-memory.ts";
import type { ReplyMemoryContext } from "../packages/phone-protocol/src/reply-memory.ts";

it.skipIf(process.platform === "win32")("isolates project reads, transcripts and learning in real dispatch; keeps reviews and safe skill import", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "yarvan-project-"));
  const routes = join(scratch, "helper.json");
  const capKey = randomUUID();
  const quote = "The docking beacon is smoked turquoise for this quarter";
  const learned = "This project's docking beacon is smoked turquoise";
  const historyOnly = "The quartz archive manifest is labeled CAMELLIA-718";
  writeFileSync(routes, JSON.stringify({ [CAPTURE_MARKER]: JSON.stringify([{ kind: "fact", text: learned, evidence: quote }]) }));
  const fixture = await launchVerificationServer({ ...process.env, OMB_TEST_INTERNAL_CAPABILITY_KEY: capKey, FAKE_CLAUDE_VERSION: "2.1.306", FAKE_CLAUDE_TEXT_ROUTES: routes });
  const { url } = fixture.info;
  const api = async <T = unknown>(path: string, method = "GET", body?: unknown, status = 200, extra: Record<string, string> = {}): Promise<T> => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value as T;
  };
  try {
    expect(await api("/api/edition")).toMatchObject({ edition: "oss" });
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Project fixture" }, 201);
    const base = `/api/bots/${bot.id}`;
    const task = async (settings: object = {}) => (await api<{ task: WireTask }>(`${base}/tasks`, "POST", settings, 201)).task;
    const create = async (name: string) => (await api<{ project: BotProject }>(`${base}/projects`, "POST", { name, memoryMode: "project-only" }, 201)).project;
    const turn = async (thread: string, text: string) => {
      rmSync(fixture.fixtureDumpPath, { force: true });
      const args = ["--bot", bot.id, "--task", thread, "--url", url];
      await runControlOmb(["send", "--text", text, ...args]);
      expect(await runControlOmb(["wait", "--timeout", "20", ...args])).toMatchObject({ status: "settled" });
      return JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { argv: string[]; prompt: unknown; systemPrompt: string };
    };
    const p1 = await create("Sahand"), p2 = await create("Alborz");
    const writer = await task({ projectId: p1.id });
    const reader = await task({ projectId: p1.id });
    const other = await task({ projectId: p2.id });
    const regular = await task();
    const off = await task({ projectId: p1.id, memoryOff: true });
    const scope = `${base}/projects/${p1.id}/memory`, scope2 = `${base}/projects/${p2.id}/memory`;
    expect(writer.projectMemory).toBe(true);
    await api(`${base}/projects/${p1.id}`, "PATCH", { memoryMode: null }, 400);
    await api(`${base}/tasks/${writer.threadId}`, "PATCH", { projectId: null }, 409);
    await api(`${base}/tasks/${regular.threadId}`, "PATCH", { projectId: p1.id }, 409);
    await api(`${base}/projects/${p1.id}`, "DELETE", undefined, 409);
    await api(`${base}/messages`, "POST", { threadId: writer.threadId, mode: "goal", text: "Use background automation" }, 409);
    const empty = await api<ProjectMemorySnapshot>(scope);
    await api(scope, "PUT", { revision: empty.revision, text: "Use project lookup key NARVAN-710." });
    await api(scope, "PUT", { revision: empty.revision, text: "stale write" }, 409);
    await api("/api/config", "PUT", { profile: { aboutMe: "ABOUT-ME-CANARY" } });
    await api(`${base}/memory/file`, "PUT", { path: "MEMORY.md", text: "- Global note IRIDIUM-CANARY\n" });
    await api(`${base}/memory/suggestions`, "PUT", { enabled: true });
    const pins = await api<PinnedMemorySnapshot>(`${base}/memory/pinned`);
    const withPins = await api<PinnedMemorySnapshot>(`${base}/memory/pinned`, "PUT", { ...pins, blocks: [
      { id: randomUUID(), title: "Global", text: "GENERAL-PIN-CANARY" },
      { id: randomUUID(), title: "Sahand", text: "SAHAND-PIN-CANARY", projectId: p1.id },
    ] });
    await api(`${base}/memory/pinned`, "PUT", { ...withPins, blocks: withPins.blocks.map((block) => ({ ...block, projectId: undefined })) }, 409);
    const first = await turn(writer.threadId, `${quote}. ${historyOnly}. Reply with just: okay`);
    expect(first.argv).toContain("--no-session-persistence");
    expect(first.argv[first.argv.indexOf("--tools") + 1]).toBe("");
    expect(first.systemPrompt).toContain("NARVAN-710");
    expect(first.systemPrompt).toContain("SAHAND-PIN-CANARY");
    expect(JSON.stringify(first)).not.toMatch(/ABOUT-ME|IRIDIUM|GENERAL-PIN/);
    await expect.poll(async () => (await api<ProjectMemorySnapshot>(scope)).pending.length, { timeout: 14_000 }).toBe(1);
    const pending = await api<ProjectMemorySnapshot>(scope);
    expect(pending).toMatchObject({ learned: [], pending: [{ text: learned, threadId: writer.threadId }] });
    expect(await api(scope2)).toMatchObject({ text: "", learned: [], pending: [] });
    expect(await api(`${base}/memory/suggestions`)).toMatchObject({ pending: [] });
    await api(scope, "POST", { revision: pending.revision, id: pending.pending[0]!.id, decision: "approve" });
    const second = await turn(reader.threadId, "What do we know about the docking beacon? Reply with just: okay");
    expect(second.systemPrompt).toContain(learned);
    expect(second.systemPrompt).toContain(quote);
    const recalled = await turn(reader.threadId, "Where is the quartz archive manifest? Reply with just: okay");
    expect(recalled.systemPrompt).toContain("CAMELLIA-718");
    expect(recalled.systemPrompt).toContain("project chat");
    await turn(reader.threadId, "What do we know about the docking beacon? Reply with just: okay");
    const getReply = async (id: string) => (await api<{ messages: WireMessage[] }>(`/api/threads/${id}/messages`)).messages.findLast((line) => line.role === "bot" && line.kind === "text")!;
    expect(await api<ReplyMemoryContext>(`${base}/tasks/${reader.threadId}/replies/${(await getReply(reader.threadId)).id}/memory`)).toMatchObject({ mode: "on", items: expect.arrayContaining([expect.objectContaining({ label: "Project memory", text: learned })]) });
    for (const id of [regular.threadId, other.threadId, off.threadId]) {
      const outside = await turn(id, "What are the docking beacon and quartz archive manifest? Reply with just: okay");
      expect(JSON.stringify(outside)).not.toMatch(/NARVAN-710|SAHAND-PIN|smoked turquoise|CAMELLIA-718/);
    }
    const { task: fork } = await api<{ task: WireTask }>(`${base}/tasks/${writer.threadId}/forks`, "POST", { messageId: (await getReply(writer.threadId)).id }, 201);
    expect(fork).toMatchObject({ projectMemory: true, projectId: p1.id });
    const continuation = await turn(fork.threadId, "Continue from my first message. Reply with just: okay");
    expect(JSON.stringify(continuation.prompt)).toContain("CAMELLIA-718");
    expect(continuation.systemPrompt).toContain("NARVAN-710");
    expect(continuation.argv).not.toContain("--resume");
    expect(JSON.stringify(continuation)).not.toMatch(/ABOUT-ME|IRIDIUM|GENERAL-PIN/);
    const approved = await api<ProjectMemorySnapshot>(scope);
    expect(await api(scope, "POST", { revision: approved.revision, id: approved.learned[0]!.id, decision: "forget" })).toMatchObject({ learned: [], pending: [] });
    const { token } = await api<{ token: string }>("/api/testing/internal-capability", "POST", { botId: bot.id, threadId: regular.threadId }, 201, { "x-openmausbot-test-capability": capKey });
    const internal = { authorization: `Bearer ${token}` };
    const params = `fromBotId=${bot.id}&fromThreadId=${regular.threadId}`;
    expect(await api(`/api/internal/session-search?${params}&q=smoked%20turquoise`, "GET", undefined, 200, internal)).toMatchObject({ hits: [], memoryHits: [] });
    await api(`/api/internal/session-read?${params}&threadId=${writer.threadId}&messageId=${(await getReply(writer.threadId)).id}`, "GET", undefined, 404, internal);
    const name = `demo-${randomUUID()}`, description = "A safe demonstration draft";
    const skill = { name, description, source: "yarvan-browser-demonstration", text: `---\nname: ${name}\ndescription: ${description}\n---\n\nA draft that needs a test.\n` };
    await api(`${base}/skill-template`, "POST", { ...skill, enabled: true }, 403);
    expect(await api(`${base}/skill-template`, "POST", { ...skill, enabled: false }, 201)).toMatchObject({ installed: { name, enabled: false } });
  } finally { await fixture.close(); await removeTempDir(scratch); }
}, 75_000);

it.skipIf(process.platform === "win32")("checks the dedicated Telegram gate on the real loopback Bot API", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_VERSION: "2.1.306" });
  const { url } = fixture.info;
  const api = (path: string, method: string, body: object) => fetch(url + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const { bot } = await (await api("/api/bots", "POST", { name: "Telegram fixture" })).json() as { bot: WireBot };
    const target = `/api/bots/${bot.id}`;
    const key = await (await api(`${target}/bot-api`, "POST", { enabled: true })).json() as { url: string; key: string };
    const dm = key.url.replace(/\/messages$/, "/telegram");
    const headers = { "content-type": "application/json", authorization: `Bearer ${key.key}`, "x-yarvan-telegram": "private-v1" };
    expect((await fetch(`${dm}?mode=telegram`, { headers })).status).toBe(403);
    expect((await api(target, "PATCH", { memoryEnabled: false })).ok).toBe(true);
    expect(await (await fetch(`${dm}?mode=telegram`, { headers })).json()).toEqual({ telegram: "private-v1" });
    expect((await fetch(`${dm}?mode=telegram`, { headers: { ...headers, "x-forwarded-proto": "https" } })).status).toBe(404);
    expect((await fetch(`${dm}?mode=telegram`, { headers: { ...headers, authorization: "Bearer not-the-key" } })).status).toBe(401);
    expect((await api(`${target}/memory/file`, "PUT", { path: "MEMORY.md", text: "- YARVAN-GLOBAL-DM-CANARY" })).ok).toBe(true);
    const send = (endpoint: string, body: object, auth: HeadersInit = headers) => fetch(endpoint, { method: "POST", headers: auth, body: JSON.stringify(body) });
    const response = await send(dm, { message: "DM-ONLY-PEREGRINE: Reply with just: okay", wait: 8 });
    expect(response.status).toBe(200);
    const body = await response.json() as { thread: string };
    expect(body.thread).toBeTruthy();
    const replyDump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { argv: string[] };
    expect(replyDump.argv[replyDump.argv.indexOf("--tools") + 1]).toBe("");
    expect(replyDump.argv).toContain("--no-session-persistence");
    expect(JSON.stringify(replyDump)).not.toContain("YARVAN-GLOBAL-DM-CANARY");
    const next = await send(dm, { thread: body.thread, message: "What was the first message? Reply with just: okay", wait: 8 });
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ thread: body.thread });
    expect(readFileSync(fixture.fixtureDumpPath, "utf8")).toContain("DM-ONLY-PEREGRINE");
    expect((await api(`${target}/messages`, "POST", { threadId: body.thread, text: "DM-local-only-fixture" })).status).toBe(409);
    expect((await api(`${target}/start-fresh`, "POST", { threadId: body.thread })).status).toBe(409);
    const responseThread = await fetch(`${url}/api/threads/${body.thread}/messages`).then((res) => res.json()) as { messages: WireMessage[] };
    expect((await api(`${target}/tasks/${body.thread}/forks`, "POST", { messageId: responseThread.messages.at(-1)?.id })).status).toBe(409);
    const ordinary = await send(key.url, { message: "Reply with just: okay", wait: 8 }, { "content-type": "application/json", authorization: headers.authorization });
    expect(ordinary.status).toBe(200);
    const ordinaryThread = await ordinary.json() as { thread: string };
    expect((await send(dm, { thread: ordinaryThread.thread, message: "stay separate", wait: 5 })).status).toBe(404);
    expect((await fetch(`${key.url}?thread=${body.thread}`, { headers: { authorization: headers.authorization } })).status).toBe(404);
    expect((await api(`${target}/bot-api/acts-as-owner`, "POST", { enabled: true })).ok).toBe(true);
    expect((await fetch(`${dm}?mode=telegram`, { headers })).status).toBe(403);
  } finally { await fixture.close(); }
}, 45_000);

it.skipIf(process.platform === "win32")("recalls a paraphrased topic via the opted-in loopback embedder in an actual chat", async () => {
  const { createServer } = await import("node:http");
  let embedded = 0, available = true;
  const provider = createServer(async (req, res) => {
    if (!available) return res.writeHead(503).end();
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const { input } = JSON.parse(raw) as { input: string[] };
    embedded++;
    const vectors = input.map((text) => /ثبت|فرستیم/.test(text) ? [1, 0] : [0, 1]);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ embeddings: vectors }));
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP fixture.");
    fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_VERSION: "2.1.306", YARVAN_LOCAL_EMBEDDING_MODEL: "fixture", YARVAN_LOCAL_EMBEDDING_PORT: String(address.port) });
    const { url } = fixture.info, dump = fixture.fixtureDumpPath;
    const put = (path: string, method: string, body: object) => fetch(url + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const { bot } = await (await put("/api/bots", "POST", { name: "Hybrid fixture" })).json() as { bot: WireBot };
    const base = `/api/bots/${bot.id}`;
    expect((await put(base, "PATCH", { memoryUpkeep: false })).ok).toBe(true);
    expect((await put(`${base}/memory/file`, "PUT", { path: "memory/ops.md", text: "---\ntitle: Operations\n---\nثبت صورت‌جلسه پس از جلسه است. CANARY-FIXTURE-NOTES" })).ok).toBe(true);
    const ask = async (text: string) => {
      rmSync(dump, { force: true });
      const args = ["--bot", bot.id, "--url", url, "--task", bot.threadId];
      await runControlOmb(["send", "--text", text, ...args]);
      await runControlOmb(["wait", "--timeout", "12", ...args]);
      return readFileSync(dump, "utf8");
    };
    const hybrid = await ask("تا کی باید بفرستیم؟ Reply with just: okay");
    expect(embedded).toBe(1);
    expect(hybrid.includes("CANARY-FIXTURE-NOTES")).toBe(true);
    available = false;
    expect((await ask("Where is CANARY-FIXTURE-NOTES mentioned? Reply with just: okay")).includes("memory/ops.md")).toBe(true);
  } finally {
    await fixture?.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
}, 35_000);
