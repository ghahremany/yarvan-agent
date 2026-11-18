import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { createLocalHybridSearch, lexicalRank, ollamaLocalEmbed } from "./local-hybrid-recall.ts";

const date = { id: "due", label: "Memory", text: "مهلت تحویل سفارش چهارشنبه است", at: 1 };
const exact = { id: "code", label: "Memory", text: "کد مرجع سفارش ۴۰۳۷", at: 2 };

it("normalizes فارسی digits and keeps exact keyword hits", () => {
  expect(lexicalRank("كد 4037", [date, exact]).map((x) => x.id)).toEqual(["code"]);
});

it("fuses semantic paraphrases with exact hits and never reuses vectors across scopes or edits", async () => {
  const embed = vi.fn(async (texts: readonly string[]) => texts.map((text) => /مهلت|تا کی/.test(text) ? [1, 0] : [0, 1]));
  const search = createLocalHybridSearch(embed);
  expect((await search("p1", "تا کی بفرستیم؟", [date, exact])).map((x) => x.id)).toEqual(["due"]);
  expect((await search("p1", "کد 4037", [date, exact]))[0]?.id).toBe("code");
  expect(embed.mock.calls[1]?.[0]).toEqual(["کد 4037"]);
  await search("p2", "تا کی بفرستیم؟", [date]);
  expect(embed.mock.calls[2]?.[0]).toHaveLength(2);
  await search("p1", "تا کی بفرستیم؟", [{ ...date, text: "مهلت تحویل پنجشنبه است" }]);
  expect(embed.mock.calls[3]?.[0]).toHaveLength(2);
  expect(await search("p1", "تا کی بفرستیم؟", [])).toEqual([]);
});

it("works through a loopback Ollama contract and falls back on timeout/errors or malformed vectors", async () => {
  let fail = false;
  const server = createServer(async (req, res) => {
    expect(req.url).toBe("/api/embed");
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const { model, input } = JSON.parse(raw) as { model: string; input: string[] };
    expect(model).toBe("fixture-embed");
    if (fail) return res.writeHead(503).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ embeddings: input.map(() => [1, 2]) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback.");
    const search = createLocalHybridSearch(ollamaLocalEmbed("fixture-embed", fetch, address.port));
    expect((await search("one", "تا کی بفرستیم؟", [date]))[0]?.id).toBe("due");
    fail = true;
    expect(await search("one", "4037", [date, exact])).toEqual([exact]);
    expect(await createLocalHybridSearch(async () => [[1], [0, 1]])("one", "4037", [exact])).toEqual([exact]);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
