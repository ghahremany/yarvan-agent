// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { z } from "zod";
import type { MemorySuggestion } from "../../shared/memory-suggestions.ts";
import { readReplyMemoryContext } from "../message-db.ts";
import { decideMemorySuggestion, memorySuggestions, setMemoryReview } from "../memory-suggestions.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const reviewSetting = z.strictObject({ enabled: z.boolean() });
const reviewDecision = z.strictObject({ id: z.uuidv4(), decision: z.enum(["approve", "reject"]) });

export function createMemoryExperienceRoutes(deps: {
  enabled: () => boolean;
  hasBot: (id: string) => boolean;
  hasThread: (id: string, threadId: string) => boolean;
  canApprove: (id: string, item: MemorySuggestion) => boolean;
}): RouteHandler {
  return async ({ path, method, auth, req, res, json, readBody }) => {
    const reply = /^\/api\/bots\/([\w-]{1,128})\/tasks\/([\w-]{1,128})\/replies\/([\w-]{1,128})\/memory$/.exec(path);
    const queue = /^\/api\/bots\/([\w-]{1,128})\/memory\/suggestions$/.exec(path);
    if (!(reply && method === "GET") && !(queue && ["GET", "PUT", "POST"].includes(method))) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the workspace owner can open these notes." });
    const id = (reply ?? queue)![1]!;
    const available = () => deps.enabled() && deps.hasBot(id);
    const notAvailable = () => json(res, 404, { error: "This memory view is not available." });
    if (!available()) return notAvailable();
    res.setHeader("Cache-Control", "no-store");
    if (reply) {
      if (!deps.hasThread(id, reply[2]!)) return notAvailable();
      const memory = readReplyMemoryContext(reply[2]!, reply[3]!);
      return memory ? json(res, 200, memory) : notAvailable();
    }
    if (method === "GET") return json(res, 200, memorySuggestions(id));
    const body = await readBody(req, 4 * 1024);
    if (!available()) return notAvailable();
    if (method === "PUT") {
      const parsed = reviewSetting.safeParse(body);
      return parsed.success ? json(res, 200, setMemoryReview(id, parsed.data.enabled)) : json(res, 400, { error: "enabled must be a boolean" });
    }
    const parsed = reviewDecision.safeParse(body);
    if (!parsed.success) return json(res, 400, { error: "Choose a pending suggestion and approve or reject it." });
    const result = decideMemorySuggestion(id, parsed.data.id, parsed.data.decision, { canApprove: (item) => deps.canApprove(id, item) });
    return result.ok ? json(res, 200, result.queue) : json(res, result.status, { error: result.error });
  };
}
