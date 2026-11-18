// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { pinnedMemoryWriteSchema, readPinnedMemory, savePinnedMemory } from "../pinned-memory.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createPinnedMemoryRoutes(deps: { enabled: () => boolean; hasBot: (botId: string) => boolean; hasProject: (botId: string, projectId: string) => boolean; projectOnly?: (botId: string, projectId: string) => boolean }): RouteHandler {
  return async ({ path, method, auth, req, res, json, readBody }) => {
    const match = /^\/api\/bots\/([\w-]{1,128})\/memory\/pinned$/.exec(path);
    if (!match || (method !== "GET" && method !== "PUT")) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the workspace owner can manage pinned memory." });
    const botId = match[1]!;
    const available = () => deps.enabled() && deps.hasBot(botId);
    if (!available()) return json(res, 404, { error: "Pinned memory is not available for this bot." });
    res.setHeader("Cache-Control", "no-store");
    if (method === "GET") return json(res, 200, readPinnedMemory(botId));

    const parsed = pinnedMemoryWriteSchema.safeParse(await readBody(req, 32 * 1024));
    if (!parsed.success) return json(res, 400, { error: "Invalid pinned memory blocks or revision." });
    if (!available()) return json(res, 404, { error: "Pinned memory is not available for this bot." });
    // A deleted project's existing blocks stay dormant. Never create or reassign to an unknown project.
    const original = readPinnedMemory(botId);
    if (original.revision !== parsed.data.revision) return json(res, 409, { error: "Pinned memory changed in another window.", current: original });
    if (parsed.data.blocks.some(({ id, projectId }) => projectId && !deps.hasProject(botId, projectId) &&
      !original.blocks.some((block) => block.id === id && block.projectId === projectId))) {
      return json(res, 400, { error: "Choose a project belonging to this bot." });
    }
    if (parsed.data.blocks.some(({ id, projectId }) => {
      const oldScope = original.blocks.find((block) => block.id === id)?.projectId;
      return oldScope && oldScope !== projectId && deps.projectOnly?.(botId, oldScope);
    })) return json(res, 409, { error: "A project-only pin stays within its project." });
    const result = savePinnedMemory(botId, parsed.data);
    if (result.kind === "invalid") return json(res, 400, { error: "A pinned block does not fit after secrets were removed. Shorten the note and try again." });
    if (result.kind === "conflict") return json(res, 409, { error: "Pinned memory changed in another window.", current: result.snapshot });
    return json(res, 200, result.snapshot);
  };
}
