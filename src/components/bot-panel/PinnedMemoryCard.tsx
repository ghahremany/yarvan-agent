// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { randomUuid } from "@/lib/random-uuid";
import {
  PINNED_MEMORY_MAX_BLOCKS, type PinnedMemoryBlock,
} from "../../../shared/pinned-memory";
import { PROJECT_ONLY } from "../../../shared/project-memory";
import type { BotProject } from "../../../shared/wire";
import { PinnedMemoryFields, pinScopeLabel } from "./PinnedMemoryFields";
import { usePinnedMemory } from "./use-pinned-memory";
import { buttonCls, Card, NoteRow, rowCls, TrashButton } from "./rows";

export function PinnedMemoryCard({ botId, enabled, projects = [] }: {
  botId: string; enabled: boolean; projects?: readonly BotProject[];
}) {
  const memory = usePinnedMemory(botId);
  const { snapshot, saving, error, setError } = memory;
  const [draft, setDraft] = useState<PinnedMemoryBlock | null>(null);
  const [undo, setUndo] = useState<PinnedMemoryBlock[] | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const draftId = draft?.id;

  useEffect(() => {
    if (draftId) titleField.current?.focus();
  }, [draftId]);

  const start = (block: PinnedMemoryBlock) => {
    setError("");
    setDraft(block);
  };
  const original = draft && snapshot?.blocks.find((block) => block.id === draft.id);
  const updating = Boolean(original);
  const scopeLocked = projects.some((project) => project.id === original?.projectId && project.memoryMode === PROJECT_ONLY);
  const full = (snapshot?.blocks.length ?? 0) >= PINNED_MEMORY_MAX_BLOCKS;
  const save = async () => {
    if (!draft || !snapshot || !draft.title.trim() || !draft.text.trim() || (full && !updating)) return;
    const next = updating
      ? snapshot.blocks.map((block) => block.id === draft.id ? draft : block)
      : [...snapshot.blocks, draft];
    if (await memory.write(next)) { setUndo(null); setDraft(null); }
  };
  const remove = async (id: string) => {
    if (!snapshot) return;
    setUndo(null);
    const next = await memory.write(snapshot.blocks.filter((block) => block.id !== id));
    if (next) setUndo(snapshot.blocks);
  };

  return (
    <Card label={t("memory.pinned.title")} anchor="pinned-memory">
      <NoteRow>{t(enabled ? "memory.pinned.hint" : "memory.pinned.off")}</NoteRow>
      {!snapshot && !error && <NoteRow>{t("common.checking")}</NoteRow>}
      {snapshot?.blocks.map((block) => (
        <div key={block.id} data-pinned-memory-block="" className={cn(rowCls, "flex-wrap items-start")}>
          <div className="min-w-0 flex-1 basis-36 [overflow-wrap:anywhere]">
            <div dir="auto" className="text-[14px] font-medium text-ink">{block.title}</div>
            <span className="text-[11px] text-ink-tertiary">{pinScopeLabel(block.projectId, projects)}</span>
            <p dir="auto" className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug text-ink-secondary">{block.text}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className={buttonCls} disabled={saving || draft !== null} aria-label={t("memory.pinned.editBlock", { title: block.title })} onClick={() => start(block)}>
              {t("botSettings.simple.edit")}
            </button>
            <TrashButton label={t("memory.pinned.deleteBlock", { title: block.title })} disabled={saving || draft !== null} onClick={() => void remove(block.id)} />
          </div>
        </div>
      ))}
      {error && (
        <NoteRow tone="warn">
          <span role="alert">{error}</span>
          {!snapshot && (
            <button type="button" className={cn(buttonCls, "mt-2 block")} onClick={memory.retry}>
              {t("common.tryAgain")}
            </button>
          )}
        </NoteRow>
      )}
      {draft ? (
        <form className="space-y-2.5 px-3.5 py-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <PinnedMemoryFields draft={draft} setDraft={setDraft} projects={projects} disabled={saving} titleField={titleField} scopeLocked={scopeLocked} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonCls} disabled={saving || !draft.title.trim() || !draft.text.trim() || (full && !updating)}>{t(updating ? "common.save" : "common.add")}</button>
            <button type="button" className={buttonCls} disabled={saving} onClick={() => { setDraft(null); setError(""); }}>{t("common.cancel")}</button>
          </div>
          {full && !updating && <p className="text-[13px] text-ink-secondary">{t("memory.pinned.full", { count: PINNED_MEMORY_MAX_BLOCKS })}</p>}
        </form>
      ) : snapshot && (
        full ? <NoteRow>{t("memory.pinned.full", { count: PINNED_MEMORY_MAX_BLOCKS })}</NoteRow> : (
          <div className={rowCls}>
            <button type="button" className={buttonCls} disabled={saving} onClick={() => start({ id: randomUuid(), title: "", text: "" })}>
              <Plus size={14} aria-hidden="true" />{t("memory.pinned.add")}
            </button>
          </div>
        )
      )}
      {undo && !memory.conflict && draft === null && (
        <div className={rowCls}>
          <span role="status" className="min-w-0 flex-1 text-[13px] text-ink-secondary">{t("memory.pinned.deleted")}</span>
          <button type="button" className={buttonCls} disabled={saving} onClick={() => { setUndo(null); void memory.write(undo); }}>{t("common.undo")}</button>
        </div>
      )}
    </Card>
  );
}
