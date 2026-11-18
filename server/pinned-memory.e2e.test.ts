// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { PinnedMemorySnapshot } from "../shared/pinned-memory.ts";
import type { WireBot } from "../shared/wire.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

it("uses the latest pinned blocks in private chats, keeps them across a restart, and never gives them to a different bot", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-pinned-memory-"));
  const prompts = join(scratch, "prompts.jsonl");
  const parentEnv = { ...process.env, FAKE_CLAUDE_PROMPTS: prompts };
  const fixture = await launchVerificationServer(parentEnv);
  const { url, dataDir } = fixture.info;
  let restarted: ChildProcess | undefined;
  const api = async <T>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const sent = () => {
    try { return readFileSync(prompts, "utf8").split("\n").filter(Boolean); }
    catch { return []; }
  };
  const turn = async (botId: string, threadId: string, text: string) => {
    const before = sent().length;
    const target = ["--bot", botId, "--task", threadId, "--url", url];
    await runControlOmb(["send", "--text", text, ...target]);
    expect(await runControlOmb(["wait", "--timeout", "30", ...target])).toMatchObject({ status: "settled" });
    const newPrompts = sent().slice(before);
    expect(newPrompts.length, "the fake engine received a turn").toBeGreaterThan(0);
    return newPrompts.join("\n");
  };
  const preview = async (botId: string) => JSON.stringify(await api(`/api/bots/${botId}/system-prompt`));

  try {
    expect(await api("/api/config")).toMatchObject({ pinnedMemory: true });
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Memo" }, 201);
    const { bot: other } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Other" }, 201);
    await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
    const path = `/api/bots/${bot.id}/memory/pinned`;
    await api("/api/bots/absent/memory/pinned", "GET", undefined, 404);
    const empty = await api<PinnedMemorySnapshot>(path);
    const block = { id: randomUUID(), title: "Project", text: "کد پروژه: نارون-۸۳" };
    const first = await api<PinnedMemorySnapshot>(path, "PUT", { ...empty, blocks: [block] });
    expect(first.blocks).toEqual([block]);
    expect(await api(path, "PUT", empty, 409)).toMatchObject({ current: first });
    expect(await preview(bot.id)).toContain(block.text);
    expect(await turn(bot.id, bot.threadId, "Hello.")).toContain(block.text);
    const { task } = await api<{ task: { threadId: string } }>(`/api/bots/${bot.id}/tasks`, "POST", { title: "Fresh conversation" }, 201);
    expect(await turn(bot.id, task.threadId, "Hello again.")).toContain(block.text);
    expect(await turn(other.id, other.threadId, "Hello.")).not.toContain(block.text);

    const edited = { ...block, text: "کد پروژه: انار-۲۱" };
    const second = await api<PinnedMemorySnapshot>(path, "PUT", { ...first, blocks: [edited] });
    const resumed = await turn(bot.id, task.threadId, "Next.");
    expect(resumed).toContain(edited.text);
    expect(resumed).not.toContain(block.text);
    await api(`/api/bots/${bot.id}`, "PATCH", { memoryEnabled: false });
    expect(await turn(bot.id, task.threadId, "Next without memory.")).not.toContain(edited.text);
    expect(await api(path)).toEqual(second);
    await api(`/api/bots/${bot.id}`, "PATCH", { memoryEnabled: true });

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      env: verificationServerEnvironment(parentEnv, dataDir, Number(new URL(url).port)),
      stdio: "ignore",
    });
    await expect.poll(async () => fetch(`${url}/api/health`).then((response) => response.ok).catch(() => false), { timeout: 20_000 }).toBe(true);
    expect(await api(path)).toEqual(second);
    expect(await preview(bot.id)).toContain(edited.text);
    await api(path, "PUT", { ...second, blocks: [] });
    expect(await turn(bot.id, task.threadId, "Next after deleting.")).not.toContain(edited.text);
    expect(await api(path)).toEqual(empty);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    await removeTempDir(scratch);
  }
}, 120_000);
