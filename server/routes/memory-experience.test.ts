// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { expect, it, vi } from "vitest";
import { createMemoryExperienceRoutes } from "./memory-experience.ts";
import { createPinnedMemoryRoutes } from "./pinned-memory.ts";
import type { RouteContext } from "./table.ts";

it.each([
  ["GET", "/api/bots/notes/memory/pinned"],
  ["PUT", "/api/bots/notes/memory/pinned"],
  ["GET", "/api/bots/notes/memory/suggestions"],
  ["POST", "/api/bots/notes/memory/suggestions"],
  ["GET", "/api/bots/notes/tasks/chat/replies/message/memory"],
])("requires owner authority for %s %s, even from service-trust loopback", async (method, path) => {
  const touched = vi.fn(() => { throw new Error("Must not look up the bot or read private data."); });
  const deps = { enabled: touched, hasBot: touched, hasProject: touched, hasThread: touched, canApprove: touched };
  const route = path.endsWith("/pinned") ? createPinnedMemoryRoutes(deps) : createMemoryExperienceRoutes(deps);
  const json = vi.fn();
  const res = {};
  await route({ method, path, res, json, readBody: touched, auth: { kind: "loopback", trust: "service", scopes: ["client"] } } as unknown as RouteContext);
  expect(json).toHaveBeenCalledExactlyOnceWith(res, 403, { error: expect.stringContaining("owner") });
  expect(touched).not.toHaveBeenCalled();
});
