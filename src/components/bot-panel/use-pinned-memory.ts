// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/api";
import type { PinnedMemoryBlock, PinnedMemorySnapshot } from "../../../shared/pinned-memory";

function isSnapshot(value: unknown): value is PinnedMemorySnapshot {
  return Boolean(value && typeof value === "object" && "revision" in value && typeof value.revision === "string" &&
    "blocks" in value && Array.isArray(value.blocks) && value.blocks.every((block: unknown) =>
      block !== null && typeof block === "object" && "id" in block && typeof block.id === "string" &&
      "title" in block && typeof block.title === "string" && "text" in block && typeof block.text === "string" &&
      (!("projectId" in block) || typeof block.projectId === "string")));
}

export function usePinnedMemory(botId: string) {
  const path = `/api/bots/${encodeURIComponent(botId)}/memory/pinned`;
  const [snapshot, setSnapshot] = useState<PinnedMemorySnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setError(""); setAttempt((n) => n + 1); };

  useEffect(() => {
    const controller = new AbortController();
    void api<unknown>(path, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      if (!isSnapshot(next)) throw new Error("Invalid pinned memory response.");
      setSnapshot(next);
    }).catch(() => {
      if (!controller.signal.aborted) setError(t("memory.pinned.loadError"));
    });
    return () => controller.abort();
  }, [path, attempt]);

  const write = async (blocks: PinnedMemoryBlock[]) => {
    if (!snapshot || saving) return false;
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      const saved = await api<unknown>(path, { method: "PUT", body: JSON.stringify({ revision: snapshot.revision, blocks }) });
      if (!isSnapshot(saved)) throw new Error("Invalid pinned memory response.");
      setSnapshot(saved);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && isSnapshot(cause.body?.current)) {
        setSnapshot(cause.body.current);
        setConflict(true);
        setError(t("memory.pinned.changed"));
      } else {
        setError(cause instanceof ApiError ? cause.message : t("memory.pinned.saveError"));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { snapshot, saving, error, setError, conflict, retry, write };
}
