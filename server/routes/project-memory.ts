import { z } from "zod";
import { PROJECT_TEXT_LIMIT, type ProjectMemoryEntry } from "../../shared/project-memory.ts";
import type { ProjectMemoryStore } from "../project-memory.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const notes = z.strictObject({ revision, text: z.string().max(PROJECT_TEXT_LIMIT) });
const decision = z.strictObject({ revision, id: z.uuidv4(), decision: z.enum(["approve", "reject", "forget"]) });

export function createProjectMemoryRoutes(deps: {
  storage: ProjectMemoryStore;
  available(bot: string, project: string): boolean;
  canApprove(bot: string, project: string, item: ProjectMemoryEntry): boolean;
}): RouteHandler {
  return async ({ path, method, auth, req, res, json, readBody }) => {
    const m = /^\/api\/bots\/([\w-]{1,128})\/projects\/([\w-]{1,128})\/memory$/.exec(path);
    if (!m || !["GET", "PUT", "POST"].includes(method)) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Project memory is private to the workspace owner." });
    const [bot, project] = [m[1]!, m[2]!];
    res.setHeader("cache-control", "no-store");
    if (!deps.available(bot, project)) return json(res, 404, { error: "Project memory is unavailable." });
    if (method === "GET") return json(res, 200, deps.storage.read(bot, project));
    const parsed = (method === "PUT" ? notes : decision).safeParse(await readBody(req, 52 * 1024));
    if (!deps.available(bot, project)) return json(res, 404, { error: "Project memory is unavailable." });
    if (!parsed.success) return json(res, 400, { error: "Invalid project memory change." });
    const changed = deps.storage.update(bot, project, parsed.data, (item) => deps.canApprove(bot, project, item));
    return json(res, changed.status, changed.status === 200 ? changed.snapshot : { error: "Project memory has changed or the source is unavailable. Reload before saving." });
  };
}
