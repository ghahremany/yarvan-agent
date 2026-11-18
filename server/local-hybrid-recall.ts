import { createHash } from "node:crypto";

export interface HybridNote { id: string; label: string; text: string; at: number }
export type Embed = (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
const MAX_NOTES = 64;
const MAX_CACHE = 448;
const MAX_DIM = 4096;
const MIN_SIMILARITY = 0.58;

function stems(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().replace(/\p{M}/gu, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) - (d >= "۰" ? 0x06f0 : 0x0660))).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function lexicalRank(query: string, notes: readonly HybridNote[]): HybridNote[] {
  const terms = [...new Set(stems(query).filter((t) => t.length > 1))].slice(0, 32);
  if (!terms.length) return [];
  const tokens = notes.map((n) => stems(n.text));
  const average = Math.max(1, tokens.reduce((sum, row) => sum + row.length, 0) / tokens.length);
  const frequency = terms.map((term) => tokens.filter((words) => words.includes(term)).length);
  return notes.map((note, i) => {
    const words = tokens[i]!;
    const score = terms.reduce((sum, term, t) => {
      const tf = words.reduce((n, word) => n + Number(word === term), 0);
      const df = frequency[t]!;
      return sum + (tf ? Math.log1p((notes.length - df + .5) / (df + .5)) * (tf * 2.2) / (tf + 1.2 * (.25 + .75 * words.length / average)) : 0);
    }, 0);
    return { note, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || b.note.at - a.note.at).map((row) => row.note);
}

function unit(vector: readonly number[]): readonly number[] {
  if (!Array.isArray(vector) || !vector.length || vector.length > MAX_DIM || vector.some((n) => typeof n !== "number" || !Number.isFinite(n))) throw new Error("Invalid local embedding.");
  const scale = Math.hypot(...vector);
  if (!Number.isFinite(scale) || scale === 0) throw new Error("Invalid local embedding norm.");
  return vector.map((value) => value / scale);
}

export function createLocalHybridSearch(embed?: Embed, clock = Date.now) {
  const cache = new Map<string, readonly number[]>();
  let cooldown = 0;
  let inFlight = 0;
  return async (scope: string, rawQuery: string, corpus: readonly HybridNote[], options: { limit?: number; lexical?: readonly HybridNote[] } = {}): Promise<HybridNote[]> => {
    const limit = options.limit ?? 4;
    const query = rawQuery.trim().slice(0, 500);
    const notes = corpus.filter((n) => n.text.trim()).slice(0, MAX_NOTES).map((n) => ({ ...n, text: n.text.slice(0, 1100) }));
    const lexical = options.lexical ?? lexicalRank(query, notes);
    if (!embed || !query || !notes.length || clock() < cooldown || inFlight >= 2) return lexical.slice(0, limit);
    inFlight++;
    try {
      const keys = notes.map((n) => createHash("sha256").update(JSON.stringify([scope, n.id, n.text])).digest("hex"));
      const misses = keys.flatMap((key, i) => cache.has(key) ? [] : [{ key, text: notes[i]!.text }]);
      const result = await embed([query, ...misses.map((n) => n.text)]);
      if (result.length !== misses.length + 1) throw new Error("Incomplete local embeddings.");
      const target = unit(result[0]!);
      const vectors = new Map(keys.flatMap((key) => cache.has(key) ? [[key, cache.get(key)!] as const] : []));
      for (const [i, miss] of misses.entries()) vectors.set(miss.key, unit(result[i + 1]!));
      if ([...vectors.values()].some((v) => v.length !== target.length)) { cache.clear(); throw new Error("Mixed local embedding models."); }
      for (const [key, vector] of vectors) { cache.delete(key); cache.set(key, vector); }
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      const semantic = notes.map((note, i) => ({ note, score: vectors.get(keys[i]!)!.reduce((sum, n, at) => sum + n * target[at]!, 0) }))
        .filter(({ score }) => score >= MIN_SIMILARITY).sort((a, b) => b.score - a.score).map(({ note }) => note);
      const merged = new Map<string, { note: HybridNote; score: number }>();
      for (const [rows, weight] of [[lexical, 1], [semantic, .85]] as const) {
        rows.forEach((note, i) => {
          const current = merged.get(note.id);
          merged.set(note.id, { note: current?.note ?? note, score: (current?.score ?? 0) + weight / (3 + i) });
        });
      }
      return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((row) => row.note);
    } catch {
      cooldown = clock() + 15_000;
      return lexical.slice(0, limit);
    } finally { inFlight--; }
  };
}

export function ollamaLocalEmbed(model: string | undefined, request: typeof fetch = fetch, port = 11434): Embed | undefined {
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/.test(model) || /(?:[:/-]|^)cloud(?:$|[:/-])/i.test(model) ||
    !Number.isInteger(port) || port < 1024 || port > 65_535) return undefined;
  return async (input) => {
    const response = await request(`http://127.0.0.1:${port}/api/embed`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input, truncate: true }), redirect: "error", signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok || !response.body) throw new Error("Local embeddings are unavailable.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 6 * 1024 * 1024) throw new Error("Local embedding response is too large.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!raw || typeof raw !== "object" || !("embeddings" in raw) || !Array.isArray(raw.embeddings)) throw new Error("Invalid local embeddings.");
    return raw.embeddings;
  };
}
