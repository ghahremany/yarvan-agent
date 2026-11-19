// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { createContext, lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, Brain, ShieldOff } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { fetchMemoryDoc, type MemoryDoc } from "@/lib/memory";
import { t } from "@/lib/i18n";
import { randomUuid } from "@/lib/random-uuid";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import type { ReplyMemoryContext } from "../../packages/phone-protocol/src/reply-memory";
import { PROJECT_ONLY } from "../../shared/project-memory";
import { PINNED_MEMORY_MAX_BLOCKS, PINNED_MEMORY_MAX_TEXT, PINNED_MEMORY_MAX_TITLE, type PinnedMemoryBlock } from "../../shared/pinned-memory";
import { ACTION_ICON, type MessageMenuItem } from "./MessageActions";
import { PinnedMemoryFields } from "./bot-panel/PinnedMemoryFields";
import { buttonCls } from "./bot-panel/rows";
import { usePinnedMemory } from "./bot-panel/use-pinned-memory";

const MemoryTextEditor = lazy(() => import("./bot-panel/pages").then(({ MemoryTextEditor }) => ({ default: MemoryTextEditor })));

export type ChatMemoryEdit = { kind: "save"; text: string } | { kind: "pin"; id: string } | { kind: "file"; file: string };
export const ChatMemoryContext = createContext<{ save: boolean; open: (edit: ChatMemoryEdit) => void } | null>(null);

export function pinFromMessage(text: string, onOpen: (edit: ChatMemoryEdit) => void): MessageMenuItem[] {
  return text.trim() ? [{ key: "memory-pin", label: t("memory.pinned.fromMessage"), icon: <BookmarkPlus {...ACTION_ICON} />, usesSelection: true,
    onSelect: (selection) => onOpen({ kind: "save", text: selection?.trim() || text.trim() }) }] : [];
}

export function MemoryOffBanner() {
  return <div className="chat-column mx-auto flex items-center gap-2 rounded-lg bg-raised/65 px-3 py-2 text-[12px] text-ink-secondary" data-memory-off="">
    <ShieldOff size={15} className="shrink-0" aria-hidden="true" />
    <span><strong className="font-medium text-ink">{t("memory.without.label")}</strong>{" · "}{t("memory.without.hint")}</span>
  </div>;
}

export function ReplyMemory({ botId, threadId, messageId, onEdit }: {
  botId: string; threadId: string; messageId: string;
  onEdit: (edit: ChatMemoryEdit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, retry] = useState(0);
  const [error, setError] = useState(false);
  const [context, setContext] = useState<ReplyMemoryContext | null>(null);
  const dispatch = useStoreDispatch();
  useEffect(() => {
    if (!open || context) return;
    const controller = new AbortController();
    void api<ReplyMemoryContext>(`/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(threadId)}/replies/${encodeURIComponent(messageId)}/memory`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setContext(value); }, () => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [open, context, attempt, botId, threadId, messageId]);

  return <details data-reply-memory="" onToggle={(event) => setOpen(event.currentTarget.open)}
    className="my-1 max-w-[min(100%,48rem)] rounded-lg text-[12px] text-ink-secondary open:border open:border-hairline/35 open:bg-card/65">
    <summary className="cursor-pointer rounded-lg px-2.5 py-1.5 select-none hover:text-ink focus-visible:ring-2 focus-visible:ring-focus">
      <Brain size={13} className="mx-1 inline align-text-bottom" aria-hidden="true" />{t("memory.reply.title")}
    </summary>
    <div className="space-y-2 px-3 pb-3">
      {error && !context && <div role="alert" className="flex items-center gap-2">{t("memory.reply.error")}<button type="button" className={buttonCls} onClick={() => { setError(false); retry((n) => n + 1); }}>{t("common.tryAgain")}</button></div>}
      {!context && !error && <p>{t("common.checking")}</p>}
      {context?.mode === "off" && <p>{t("memory.reply.off")}</p>}
      {context?.mode === "on" && <>
        <p>{t("memory.reply.hint")}</p>
        {context.items.length === 0 && <p>{t("memory.reply.none")}</p>}
        <ol className="space-y-1.5">
          {context.items.map((item, index) => <li key={`${index}:${item.pinId ?? item.label}`} className="min-w-0 rounded-md bg-inset/50 px-2.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span dir="auto" className="font-medium text-ink [overflow-wrap:anywhere]">{item.label}</span>
              {item.pinId ? <button type="button" className={buttonCls} onClick={() => onEdit({ kind: "pin", id: item.pinId! })}>{t("memory.reply.editPin")}</button>
                : item.file ? <button type="button" className={buttonCls} onClick={() => onEdit({ kind: "file", file: item.file! })}>{t("memory.reply.editFile")}</button>
                : item.kind === "profile" ? <button type="button" className={buttonCls} onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "bots" })}>{t("memory.reply.editProfile")}</button> : null}
            </div>
            <p dir="auto" className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{item.text}</p>
          </li>)}
        </ol>
      </>}
    </div>
  </details>;
}

export function ChatMemoryDialog({ bot, edit, onClose, onSaved }: { bot: Bot; edit: ChatMemoryEdit; onClose: () => void; onSaved: () => void }) {
  if (edit.kind === "file") return <FileCorrection bot={bot} file={edit.file} onClose={onClose} onSaved={onSaved} />;
  return <PinDialog bot={bot} edit={edit} onClose={onClose} onSaved={onSaved} />;
}

function DialogFrame({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(frame, close);
  return createPortal(<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={frame} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} data-look="dialog"
      className="max-h-[min(90vh,48rem)] w-full max-w-xl overflow-auto rounded-2xl border border-hairline/45 bg-card p-5 text-ink shadow-xl outline-none">
      <h2 id={titleId} className="mb-3 text-base font-semibold [overflow-wrap:anywhere]">{title}</h2>
      {children}
    </div>
  </div>, document.body);
}

function PinDialog({ bot, edit, onClose, onSaved }: {
  bot: Bot; edit: Exclude<ChatMemoryEdit, { kind: "file" }>; onClose: () => void; onSaved: () => void;
}) {
  const memory = usePinnedMemory(bot.id);
  const task = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const current = edit.kind === "pin" ? memory.snapshot?.blocks.find((item) => item.id === edit.id) : undefined;
  const [typed, setDraft] = useState<PinnedMemoryBlock | null>(() => edit.kind === "pin" ? null : {
    id: randomUuid(), text: edit.text.slice(0, PINNED_MEMORY_MAX_TEXT),
    title: edit.text.split(/\r?\n/u, 1)[0]!.trim().slice(0, PINNED_MEMORY_MAX_TITLE),
    projectId: task?.projectId,
  });
  const draft = typed ?? current;
  const scopeLocked = task?.projectMemory === true || Boolean(bot.projects?.some((project) => project.id === current?.projectId && project.memoryMode === PROJECT_ONLY));
  const full = edit.kind === "save" && (memory.snapshot?.blocks.length ?? 0) >= PINNED_MEMORY_MAX_BLOCKS;
  const missing = edit.kind === "pin" && memory.snapshot !== null && !current;
  const canSave = Boolean(memory.snapshot && draft?.title.trim() && draft?.text.trim() && !missing && !full && !memory.saving);
  const save = async () => {
    if (!canSave || !draft || !memory.snapshot) return;
    const next = current ? memory.snapshot.blocks.map((item) => item.id === current.id ? draft : item) : [...memory.snapshot.blocks, draft];
    if (await memory.write(next)) onSaved();
  };
  const title = t(edit.kind === "save" ? "memory.pinned.fromMessage" : "memory.reply.editPin");

  return <DialogFrame title={title} close={() => { if (!memory.saving) onClose(); }}>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {edit.kind === "save" && edit.text.length > PINNED_MEMORY_MAX_TEXT && <p className="text-[13px] text-ink-secondary">{t("memory.pinned.clipped", { count: PINNED_MEMORY_MAX_TEXT })}</p>}
      {missing && <p className="text-[13px] text-ink-secondary">{t("memory.pinned.missing")}</p>}
      {draft && !missing && <PinnedMemoryFields draft={draft} setDraft={setDraft} projects={bot.projects ?? []} disabled={memory.saving} scopeLocked={scopeLocked} />}
      {full && <p className="text-[13px] text-ink-secondary">{t("memory.pinned.full", { count: PINNED_MEMORY_MAX_BLOCKS })}</p>}
      {memory.error && <div role="alert" className="text-[13px] text-danger">{memory.error}
        {!memory.snapshot && <button type="button" className={buttonCls} onClick={memory.retry}>{t("common.tryAgain")}</button>}
        {current && memory.conflict && <p dir="auto" className="whitespace-pre-wrap text-ink-secondary [overflow-wrap:anywhere]">{current.title}{"\n"}{current.text}</p>}
      </div>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={buttonCls} disabled={memory.saving} onClick={onClose}>{t("common.cancel")}</button>
        <button type="submit" className={buttonCls} disabled={!canSave}>{t(memory.saving ? "memory.saving" : "common.save")}</button>
      </div>
    </form>
  </DialogFrame>;
}

function FileCorrection({ bot, file, onClose, onSaved }: { bot: Bot; file: string; onClose: () => void; onSaved: () => void }) {
  const [doc, setDoc] = useState<MemoryDoc | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchMemoryDoc(bot.id, file).then((answer) => { if (live) setDoc(answer); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [bot.id, file]);
  return <DialogFrame title={file} close={onClose}>
    {error || doc?.exists === false ? <p role="alert" className="text-ink-secondary">{t("memory.reply.sourceMissing")}</p>
      : <Suspense fallback={<p>{t("common.checking")}</p>}>
        {doc ? <MemoryTextEditor bot={bot} doc={doc} mine={false} onDone={(saved) => { if (saved) onSaved(); else onClose(); }} /> : <p>{t("common.checking")}</p>}
      </Suspense>}
    {(error || !doc || !doc.exists) && <button type="button" className={buttonCls} onClick={onClose}>{t("common.cancel")}</button>}
  </DialogFrame>;
}
