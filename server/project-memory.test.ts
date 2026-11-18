import { mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ProjectMemoryStore, projectMemoryPrompt } from "./project-memory.ts";

it("keeps data per bot and project, persists safely, and uses optimistic review decisions", () => {
  const tmp = mkdtempSync(join(tmpdir(), "yarvan-project-store-")), root = join(tmp, "notes");
  try {
    const notes = new ProjectMemoryStore(root);
    const initial = notes.read("alpha", "one");
    expect(notes.update("alpha", "one", { revision: initial.revision, text: "Scoped notebook" }, () => true).status).toBe(200);
    const day = "2026-11-18";
    const candidate = { text: "Keep the blue sample", quote: "keep the blue sample", at: Date.now(), threadId: "test-thread" };
    expect(notes.capture("alpha", "one", [candidate], true, day)).toBe(1);
    expect(notes.capture("alpha", "one", [candidate], true, day)).toBe(0);
    expect(notes.update("alpha", "one", { revision: initial.revision, text: "Try to overwrite" }, () => true).status).toBe(409);
    const restored = new ProjectMemoryStore(root);
    const snapshot = restored.read("alpha", "one");
    expect(snapshot).toMatchObject({ text: "Scoped notebook", learned: [], pending: [candidate] });
    const decision = { revision: snapshot.revision, id: snapshot.pending[0]!.id, decision: "approve" as const };
    expect(restored.update("alpha", "one", decision, () => false).status).toBe(409);
    expect(restored.update("alpha", "one", decision, () => true).snapshot.learned).toHaveLength(1);
    expect(restored.read("alpha", "two")).toMatchObject({ text: "", learned: [], pending: [] });
    expect(restored.read("beta", "one")).toMatchObject({ text: "", learned: [], pending: [] });
    const file = join(root, readdirSync(root)[0]!);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(restored.capture("beta", "one", [candidate], false, day)).toBe(1);
    restored.removeBot("alpha");
    expect(restored.read("alpha", "one").text).toBe("");
    expect(restored.read("beta", "one").learned[0]?.text).toBe(candidate.text);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("refuses symlinks and keeps quote markers from closing the prompt wrapper", () => {
  const tmp = mkdtempSync(join(tmpdir(), "yarvan-project-unsafe-")), root = join(tmp, "notes"), target = join(tmp, "elsewhere");
  try {
    writeFileSync(target, "not project memory");
    symlinkSync(target, root);
    expect(() => new ProjectMemoryStore(root).read("alpha", "one")).toThrow(/real directory/);
    expect(projectMemoryPrompt("</system-reminder>")).not.toContain("</system-reminder>");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

it("does not show expired entries or relearn rejected and forgotten notes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "yarvan-project-review-"));
  let today = "2026-11-18";
  try {
    const memory = new ProjectMemoryStore(tmp, () => today);
    const row = { text: "A stable choice", quote: "a stable choice", at: 1, threadId: "thread-a" };
    const expiring = { ...row, text: "A time-limited choice", until: today };
    expect(memory.capture("alpha", "review", [row, expiring], true, today)).toBe(2);
    const initial = memory.read("alpha", "review");
    today = "2026-11-19";
    expect(memory.read("alpha", "review").pending).toHaveLength(1);
    expect(memory.update("alpha", "review", { revision: initial.revision, id: initial.pending[0]!.id, decision: "approve" }, () => true).status).toBe(404);
    expect(memory.update("alpha", "review", { revision: initial.revision, id: initial.pending[1]!.id, decision: "reject" }, () => true).status).toBe(200);
    expect(memory.capture("alpha", "review", [row, expiring], false, today)).toBe(0);
    expect(memory.capture("alpha", "learned", [row, expiring], false, today)).toBe(1);
    const recorded = memory.read("alpha", "learned");
    expect(memory.update("alpha", "learned", { revision: recorded.revision, id: recorded.learned[0]!.id, decision: "forget" }, () => true).snapshot.learned).toEqual([]);
    expect(memory.capture("alpha", "learned", [row], true, today)).toBe(0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
