// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACES_DIR, workspaceDir } from "./workspace.ts";

export function privateWorkspaceJsonPath(botId: string, file: string): string {
  if (!/^[\w-]{1,128}$/.test(botId)) throw new Error("Invalid bot id.");
  const workspace = workspaceDir(botId);
  for (const dir of [WORKSPACES_DIR, workspace]) {
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (stat && !stat.isDirectory()) throw new Error("Expected a regular workspace directory.");
  }
  return join(workspace, file);
}

export function readPrivateJson(path: string, maxBytes: number): unknown {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) return undefined;
  if (!entry.isFile()) throw new Error("Memory path is not a regular file.");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Invalid memory file.");
    const bytes = Buffer.alloc(stat.size + 1);
    if (readSync(fd, bytes, 0, bytes.length, 0) !== stat.size) throw new Error("Memory file changed while reading.");
    return JSON.parse(bytes.toString("utf8", 0, stat.size));
  } finally {
    closeSync(fd);
  }
}
