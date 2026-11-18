// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { ReplyMemoryContext } from "../packages/phone-protocol/src/reply-memory.ts";
import type { PinnedMemorySnapshot } from "../shared/pinned-memory.ts";
import type { BotProject, WireBot, WireMessage, WireTask } from "../shared/wire.ts";

it("uses fresh text history and no tools on a compatible API; never replays a former project's pins", async () => {
  const MODEL = "fixture-memory-chat";
  const requests: Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown }> = [];
  const provider = createServer(async (req, res) => {
    if (req.url === "/v1/models") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: MODEL }] }));
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") return res.writeHead(404).end();
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    const parsed = JSON.parse(body);
    if (!parsed.stream) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "Fixture memory chat" }, finish_reason: "stop" }] }));
    requests.push(parsed);
    return res.writeHead(200, { "content-type": "text/event-stream" })
      .end('data: {"choices":[{"index":0,"delta":{"content":"Okay from the API."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Fixture could not bind a loopback port.");
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, ["codex"]);
    const { url } = fixture.info;
    const api = async <T>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
      const response = await fetch(url + path, {
        method, headers: { "content-type": "application/json", origin: url }, signal: AbortSignal.timeout(25_000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
      return result as T;
    };
    const { instanceId } = await api<{ instanceId: string }>("/api/instances/openai-compat", "POST", {
      displayName: "Memory API fixture", url: `http://127.0.0.1:${address.port}/v1`, key: "fixture-memory-key", models: [MODEL],
    }, 201);
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Compatible memory" }, 201);
    const base = `/api/bots/${bot.id}`;
    await api(`${base}/tasks/${bot.threadId}`, "PATCH", { modelSelection: { instanceId, model: MODEL }, updateBotDefault: true });
    await api(base, "PATCH", { memoryUpkeep: false });
    const task = async (settings: object) => (await api<{ task: WireTask }>(`${base}/tasks`, "POST", settings, 201)).task;
    const turn = async (threadId: string, text: string) => {
      const before = requests.length;
      const target = ["--bot", bot.id, "--task", threadId, "--url", url];
      await runControlOmb(["send", "--text", text, ...target]);
      await runControlOmb(["wait", "--timeout", "20", ...target]);
      expect(requests.length).toBe(before + 1);
      return requests.at(-1)!;
    };
    const replyMemory = async (threadId: string): Promise<ReplyMemoryContext> => {
      const history = await api<{ messages: WireMessage[] }>(`/api/threads/${threadId}/messages`);
      const reply = history.messages.findLast((message) => message.role === "bot" && message.kind === "text" && message.text === "Okay from the API.");
      expect(reply?.hasMemoryContext).toBe(true);
      return api(`${base}/tasks/${threadId}/replies/${reply!.id}/memory`);
    };

    const blank = bot.threadId;
    expect(await turn(blank, "Simple greeting.")).toHaveProperty("tools");
    expect(await replyMemory(blank)).toEqual({ mode: "on", items: [] });
    const { project } = await api<{ project: BotProject }>(`${base}/projects`, "POST", { name: "Scoped" }, 201);
    const scoped = await task({ projectId: project.id });
    const pinPath = `${base}/memory/pinned`, pins = await api<PinnedMemorySnapshot>(pinPath);
    const pin = { id: randomUUID(), title: "Scoped note", text: "SOLSTICE-PROJECT-SWATCH", projectId: project.id };
    await api(pinPath, "PUT", { ...pins, blocks: [pin] });
    expect(JSON.stringify(await turn(scoped.threadId, "First project message."))).toContain(pin.text);
    expect(await replyMemory(scoped.threadId)).toMatchObject({ mode: "on", items: expect.arrayContaining([expect.objectContaining({ kind: "pin", pinId: pin.id })]) });
    await api(`${base}/projects/${project.id}`, "DELETE");
    const afterDelete = JSON.stringify(await turn(scoped.threadId, "Second project message."));
    expect(afterDelete).toContain("First project message.");
    expect(afterDelete).not.toContain(pin.text);
    expect((await replyMemory(scoped.threadId)).items.every((item) => item.kind !== "pin")).toBe(true);
    expect((await api<PinnedMemorySnapshot>(pinPath)).blocks).toEqual([pin]);

    await api(`${base}/memory/file`, "PUT", { path: "MEMORY.md", text: "- SHARED-NOTE-HYACINTH\n" });
    const privateTask = await task({ memoryOff: true });
    const first = await turn(privateTask.threadId, "Standalone VANILLA-LANTERN.");
    expect(first).not.toHaveProperty("tools");
    expect(first).not.toHaveProperty("previous_response_id");
    expect(JSON.stringify(first)).not.toContain("SHARED-NOTE-HYACINTH");
    const followup = await turn(privateTask.threadId, "Same chat follow-up.");
    expect(followup).not.toHaveProperty("tools");
    expect(followup.messages.filter((message) => message.role !== "system")).toEqual([
      { role: "user", content: "Standalone VANILLA-LANTERN." },
      { role: "assistant", content: "Okay from the API." },
      { role: "user", content: "Same chat follow-up." },
    ]);
    expect(await replyMemory(privateTask.threadId)).toEqual({ mode: "off", items: [] });
    expect(JSON.stringify(await turn(blank, "Any VANILLA notes?"))).not.toContain("VANILLA-LANTERN");
    await api(`${base}/tasks/${privateTask.threadId}`, "PATCH", { modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" } });
    const count = requests.length;
    const error = await api<{ error: string }>(`${base}/messages`, "POST", { threadId: privateTask.threadId, text: "Do not use this engine." }, 409);
    expect(error.error).toContain("cannot run a chat without memory");
    expect(requests).toHaveLength(count);
  } finally {
    try { await fixture?.close(); }
    finally { provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve())); }
  }
}, 85_000);
