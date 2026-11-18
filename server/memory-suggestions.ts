// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { z } from "zod";

import { MAX_PENDING_MEMORY_SUGGESTIONS, type MemorySuggestion, type MemorySuggestionQueue } from "../shared/memory-suggestions.ts";
import { writeFileAtomic } from "./atomic.ts";
import { factIdentity, isExpired, isMemoryDate, notebookIdentities, parseMemoryEntries } from "./memory-entries.ts";
import { recordMemoryChange } from "./memory-journal.ts";
import { isForgotten } from "./profile-learned.ts";
import { privateWorkspaceJsonPath, readPrivateJson } from "./private-workspace-json.ts";
import { redactSecretsInText } from "./redact.ts";
import { memoryDate, readMemoryFile, readMemoryTopic, updateMemory, workspaceDir } from "./workspace.ts";

const FILE = "memory-suggestions.json";
const MAX_RESOLVED = 160;
const MAX_BYTES = 640 * 1024;
const schema = z.strictObject({
  enabled: z.boolean(),
  pending: z.array(z.strictObject({
    id: z.uuidv4(), text: z.string().min(1).max(600), quote: z.string().min(1).max(600),
    threadId: z.string().regex(/^[\w-]{1,128}$/), at: z.number().nonnegative(), via: z.enum(["capture", "dream"]),
    until: z.string().refine(isMemoryDate).optional(), replaces: z.string().min(1).max(1_000).optional(),
  })).max(MAX_PENDING_MEMORY_SUGGESTIONS),
  resolved: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(MAX_RESOLVED),
});
type State = z.infer<typeof schema>;
type Candidate = Omit<MemorySuggestion, "id" | "at">;

const pathFor = (botId: string) => privateWorkspaceJsonPath(botId, FILE);
const fingerprint = (text: string) => createHash("sha256").update(factIdentity(text)).digest("hex");
const expired = (item: MemorySuggestion, today: string) => Boolean(item.until && item.until < today);

function read(botId: string): State {
  const raw = readPrivateJson(pathFor(botId), MAX_BYTES);
  return raw === undefined ? { enabled: false, pending: [], resolved: [] } : schema.parse(raw);
}

function write(botId: string, state: State) {
  const path = pathFor(botId);
  const text = JSON.stringify(schema.parse(state));
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Memory suggestion queue is too large.");
  mkdirSync(workspaceDir(botId), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, text, { mode: 0o600 });
}

export function memoryReviewEnabled(botId: string): boolean {
  // A corrupt/unreadable opt-in must not silently switch automatic writing back on.
  try { return read(botId).enabled; } catch { return true; }
}

function redacted(item: MemorySuggestion): MemorySuggestion {
  return { ...item, text: redactSecretsInText(item.text), quote: redactSecretsInText(item.quote),
    ...(item.replaces ? { replaces: redactSecretsInText(item.replaces) } : {}) };
}

export function memorySuggestions(botId: string): MemorySuggestionQueue {
  const state = read(botId);
  return { enabled: state.enabled, pending: state.pending.map(redacted) };
}

export function setMemoryReview(botId: string, enabled: boolean): MemorySuggestionQueue {
  const state = read(botId);
  if (state.enabled !== enabled) write(botId, { ...state, enabled });
  return { enabled, pending: state.pending.map(redacted) };
}

/** Verify a quote against the source, not against anything else the helper model said. */
export function sourceSentence(evidence: string | undefined, lines: readonly string[]): string | undefined {
  const quote = evidence?.replace(/\s+/g, " ").trim();
  if (!quote || quote.length < 3) return undefined;
  for (const line of lines) {
    const text = line.replace(/\s+/g, " ").trim();
    const at = text.indexOf(quote);
    if (at < 0) continue;
    // Some quotes span sentences. Keep the matched quote rather than inventing a source in that case.
    const sentence = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)]
      .find(({ segment, index }) => index <= at && index + segment.length >= at + quote.length)?.segment.trim();
    return sentence && sentence.length <= 600 ? sentence : quote.slice(0, 600);
  }
  return undefined;
}

/** All-or-nothing, synchronous write after the background model's permission re-check. */
export function enqueueMemorySuggestions(botId: string, candidates: readonly Candidate[], now = new Date()): number {
  const state = read(botId);
  if (!state.enabled) return 0;
  const today = memoryDate(now);
  const pending = state.pending.filter((item) => !expired(item, today));
  const seen = new Set([...state.resolved, ...pending.map((item) => fingerprint(item.text))]);
  const notebook = notebookIdentities(readMemoryFile(botId).text);
  let added = 0;
  for (const candidate of candidates) {
    if (pending.length >= MAX_PENDING_MEMORY_SUGGESTIONS) break;
    const key = fingerprint(candidate.text);
    if (!factIdentity(candidate.text) || seen.has(key) || notebook.has(factIdentity(candidate.text)) || isForgotten(candidate.text)) continue;
    const item = redacted({ ...candidate, id: randomUUID(), at: now.getTime() });
    // The source may mention a secret; redact before saving it. Never file a redacted fact or replacement by accident.
    if (item.text !== candidate.text || item.replaces !== candidate.replaces || expired(item, today)) continue;
    if (!schema.shape.pending.element.safeParse(item).success) continue;
    pending.push(item);
    seen.add(key);
    added++;
  }
  if (added || pending.length !== state.pending.length) write(botId, { ...state, pending });
  return added;
}

export function decideMemorySuggestion(botId: string, id: string, decision: "approve" | "reject", opts: {
  canApprove: (item: MemorySuggestion) => boolean; now?: Date;
}): { ok: true; queue: MemorySuggestionQueue } | { ok: false; status: 404 | 409; error: string } {
  const state = read(botId);
  const item = state.pending.find((candidate) => candidate.id === id);
  if (!item) return { ok: false, status: 404, error: "This suggestion is no longer pending." };
  const now = opts.now ?? new Date();
  const today = memoryDate(now);
  if (decision === "approve") {
    if (!opts.canApprove(item) || expired(item, today) || isForgotten(item.text) || redactSecretsInText(item.text) !== item.text) {
      return { ok: false, status: 409, error: "This suggestion is no longer eligible. Reject it to clear it from the list." };
    }
    const before = readMemoryFile(botId).text;
    // If it was saved by hand (or the previous write succeeded but the queue write failed), do not append again.
    const already = notebookIdentities(before).has(factIdentity(item.text));
    if (!already) {
      if (item.replaces && !parseMemoryEntries(before).some((entry) => !entry.struck && !isExpired(entry, today) && entry.body === item.replaces)) {
        return { ok: false, status: 409, error: "The old note changed. Reject this suggestion and edit the current note directly." };
      }
      const archive = readMemoryTopic(botId, "archive.md");
      const result = updateMemory(botId, {
        ...(item.replaces ? { action: "supersede", oldText: item.replaces } : { action: "append" }),
        text: item.text, ...(item.until ? { until: item.until } : {}),
      }, { now, source: "approved suggestion" });
      if (!result.ok) return { ok: false, status: 409, error: result.error };
      recordMemoryChange(botId, { path: "memory/archive.md", actor: "person", via: "suggestion", threadId: item.threadId, before: archive, after: readMemoryTopic(botId, "archive.md") });
      recordMemoryChange(botId, { path: "MEMORY.md", actor: "person", via: "suggestion", threadId: item.threadId, before, after: readMemoryFile(botId).text });
    }
  }
  const pending = state.pending.filter((candidate) => candidate.id !== id);
  const resolved = [...state.resolved, fingerprint(item.text)].slice(-MAX_RESOLVED);
  write(botId, { ...state, pending, resolved });
  return { ok: true, queue: { enabled: state.enabled, pending: pending.map(redacted) } };
}
