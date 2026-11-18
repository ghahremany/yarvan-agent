// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { useEffect, useState } from "react";
import { ListChecks, RefreshCw } from "lucide-react";
import { t, intlLocale } from "@/lib/i18n";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { MAX_PENDING_MEMORY_SUGGESTIONS, type MemorySuggestionQueue } from "../../../shared/memory-suggestions";
import { buttonCls, Card, NoteRow, rowCls, SwitchRow } from "./rows";

export function MemorySuggestionsCard({ bot, onApproved }: { bot: Bot; onApproved: () => void }) {
  const route = `/api/bots/${encodeURIComponent(bot.id)}/memory/suggestions`;
  const [queue, setQueue] = useState<MemorySuggestionQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const next = await api<MemorySuggestionQueue>(route, { signal: controller.signal });
        if (!controller.signal.aborted) setQueue(next);
      } catch {
        if (!controller.signal.aborted) setError(t("memory.review.loadError"));
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 12_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [route, busy, attempt]);

  const change = async (method: "PUT" | "POST", body: object, success?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<MemorySuggestionQueue>(route, { method, body: JSON.stringify(body) });
      setQueue(result);
      if (success) setNotice(success);
      if ("decision" in body && body.decision === "approve") onApproved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("memory.review.saveError"));
    } finally { setBusy(false); }
  };

  return <Card label={t("memory.review.title")} anchor="memory-suggestions">
    <SwitchRow icon={ListChecks} title={t("memory.review.toggle")} hint={t("memory.review.hint")}
      color={bot.color} checked={queue?.enabled === true} disabled={!queue || busy}
      onChange={() => void change("PUT", { enabled: !queue?.enabled })} />
    {bot.memoryEnabled === false || bot.memoryUpkeep === false ? <NoteRow>{t("memory.review.paused")}</NoteRow> : null}
    {error && <NoteRow tone="warn"><span role="alert">{error}</span></NoteRow>}
    {notice && <NoteRow><span role="status">{notice}</span></NoteRow>}
    {!queue && !error && <NoteRow>{t("common.checking")}</NoteRow>}
    {queue && queue.pending.length === 0 && <NoteRow>{t("memory.review.empty")}</NoteRow>}
    {queue?.pending.length === MAX_PENDING_MEMORY_SUGGESTIONS && <NoteRow tone="warn">{t("memory.review.full")}</NoteRow>}
    {queue?.pending.map((item) => <div key={item.id} className={`${rowCls} flex-col items-stretch gap-2`} data-memory-suggestion="">
      <div dir="auto" className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{item.text}</div>
      {item.replaces && <div dir="auto" className="text-[12px] text-ink-secondary">{t("memory.review.replaces", { text: item.replaces })}</div>}
      <blockquote dir="auto" className="border-s-2 border-accent/30 ps-2 text-[13px] text-ink-secondary [overflow-wrap:anywhere]">{item.quote}</blockquote>
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-auto text-[11px] text-ink-tertiary">
          {bot.tasks?.find((task) => task.threadId === item.threadId)?.title ?? t("memory.review.source")}
          {" · "}{new Date(item.at).toLocaleDateString(intlLocale())}
          {item.until ? ` · ${t("memory.review.until", { date: item.until })}` : ""}
        </span>
        <button type="button" className={buttonCls} disabled={busy} onClick={() => void change("POST", { id: item.id, decision: "reject" }, t("memory.review.rejected"))}>{t("memory.review.reject")}</button>
        <button type="button" className={buttonCls} disabled={busy || bot.memoryEnabled === false} onClick={() => void change("POST", { id: item.id, decision: "approve" }, t("memory.review.approved"))}>{t("memory.review.approve")}</button>
      </div>
    </div>)}
    <div className={rowCls}>
      <button type="button" className={buttonCls} disabled={busy} onClick={() => { setError(""); setAttempt((n) => n + 1); }}>
        <RefreshCw size={14} aria-hidden="true" />{t("memory.review.refresh")}
      </button>
    </div>
  </Card>;
}
