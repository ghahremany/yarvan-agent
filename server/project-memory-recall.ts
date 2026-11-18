import type { ProjectMemorySnapshot } from "../shared/project-memory.ts";
import type { HybridNote } from "./local-hybrid-recall.ts";
import { withoutExpired, withoutSuperseded } from "./memory-entries.ts";
import { topicBody } from "./memory-topics.ts";
import { conversationPassages, recallQuery, renderRecall, type RecallInput, type RecallResult } from "./recall.ts";
import { listMemoryTopics, memoryDate, readMemoryTopic } from "./workspace.ts";
import { redactSecretsInText } from "./redact.ts";

type Search = (scope: string, query: string, notes: readonly HybridNote[], options?: { limit?: number; lexical?: readonly HybridNote[] }) => Promise<HybridNote[]>;

export async function recallProject(input: RecallInput, project: string, memory: ProjectMemorySnapshot, search: Search): Promise<RecallResult | null> {
  const query = recallQuery(input.message);
  if (!query) return null;
  const today = memoryDate();
  const notes = memory.learned.filter((entry) => !entry.until || entry.until >= today).map((entry) => ({
    id: entry.id, label: "Project memory", text: entry.text, at: entry.at,
  }));
  const hits = await search(`project:${input.botId}:${project}`, redactSecretsInText(query), notes);
  return renderRecall([...hits.map((hit) => ({ source: "memory" as const, label: hit.label, snippet: hit.text, at: hit.at })), ...conversationPassages(input, query).map((row) => ({ ...row, snippet: redactSecretsInText(row.snippet), label: redactSecretsInText(row.label) }))]);
}

export async function recallPersonalTopics(botId: string, message: string, lexical: RecallResult | null, search: Search): Promise<RecallResult | null> {
  const query = recallQuery(message);
  if (!query) return lexical;
  const safeQuery = redactSecretsInText(query);
  try {
    const today = memoryDate();
    const topics = listMemoryTopics(botId).filter((topic) => topic.name !== "archive.md").slice(0, 32);
    const notes = topics.flatMap(({ name }) => {
      const raw = readMemoryTopic(botId, name);
      if (raw === null) return [];
      const body = redactSecretsInText(topicBody(withoutSuperseded(withoutExpired(raw, today).text)));
      return (body.match(/[\s\S]{1,950}/gu) ?? []).slice(0, 4).map((text, index) => ({
        id: `${name}:${index}`, label: `memory/${name}`, text, at: 0,
      }));
    });
    const words = (lexical?.supplied ?? []).filter((row) => row.source === "memory").map((row) => ({
      id: notes.find((note) => note.label === row.label && note.text.includes(row.snippet))?.id ?? `lexical:${row.label}`,
      label: row.label, text: row.snippet, at: row.at ?? 0,
    }));
    const matches = await search(`bot:${botId}`, safeQuery, notes, { limit: 8, lexical: words });
    const distinct = [...new Map(matches.toReversed().map((note) => [note.label, note])).values()].reverse().slice(0, 4);
    return renderRecall([...distinct.map((note) => ({ source: "memory" as const, label: note.label, snippet: note.text, at: note.at || undefined })),
      ...(lexical?.supplied ?? []).filter((row) => row.source === "conversation")]);
  } catch { return lexical; }
}
