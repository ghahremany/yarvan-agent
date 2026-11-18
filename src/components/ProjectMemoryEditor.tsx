import { useEffect, useId, useState } from "react";
import type { ProjectMemoryEntry, ProjectMemorySnapshot } from "../../shared/project-memory";
import { PROJECT_TEXT_LIMIT } from "../../shared/project-memory";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";

const button = "rounded-lg border border-hairline/60 px-3 py-1.5 text-[12px] text-ink hover:bg-raised disabled:opacity-45";

export function ProjectMemoryEditor({ botId, projectId }: { botId: string; projectId: string }) {
  const path = `/api/bots/${encodeURIComponent(botId)}/projects/${encodeURIComponent(projectId)}/memory`;
  const field = useId();
  const [snapshot, setSnapshot] = useState<ProjectMemorySnapshot | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setBusy(true);
    setError(false);
    void api<ProjectMemorySnapshot>(path, { signal: request.signal }).then((value) => {
      if (!request.signal.aborted) { setSnapshot(value); setText(value.text); }
    }).catch(() => { if (!request.signal.aborted) setError(true); }).finally(() => { if (!request.signal.aborted) setBusy(false); });
    return () => request.abort();
  }, [path, reload]);
  const mutate = async (method: "PUT" | "POST", data: object) => {
    if (!snapshot || busy) return;
    setBusy(true); setError(false);
    try {
      const value = await api<ProjectMemorySnapshot>(path, { method, body: JSON.stringify({ revision: snapshot.revision, ...data }) });
      setSnapshot(value);
      if (method === "PUT") setText(value.text);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const resolve = (entry: ProjectMemoryEntry, decision: "approve" | "reject" | "forget") => void mutate("POST", { id: entry.id, decision });
  return <section aria-label={t("yarvan.project.notes")} className="mt-4 space-y-2 border-t border-hairline/40 pt-3">
    <label htmlFor={field} className="block text-[13px] font-medium">{t("yarvan.project.notes")}</label>
    <textarea id={field} disabled={busy || !snapshot} value={text} maxLength={PROJECT_TEXT_LIMIT} rows={5} dir="auto" onChange={(e) => setText(e.target.value)} className="w-full resize-y rounded-xl border border-hairline/50 bg-inset p-3 text-[13px] text-ink" />
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || !snapshot || text === snapshot.text} onClick={() => void mutate("PUT", { text })}>{t("yarvan.project.saveNotes")}</button>
      <button type="button" className={button} disabled={busy} onClick={() => setReload((n) => n + 1)}>{t("yarvan.project.reload")}</button>
    </div>
    {error && <p role="alert" className="text-[12px] text-danger">{t("yarvan.project.loadError")}</p>}
    {snapshot?.pending.map((entry) => <div key={entry.id} className="space-y-1 rounded-xl border border-hairline/40 px-3 py-2 text-[12px]">
      <strong>{t("yarvan.project.proposed")}</strong><p dir="auto">{entry.text}</p><p dir="auto" className="text-ink-secondary">{entry.quote}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => resolve(entry, "approve")}>{t("yarvan.project.approve")}</button>
        <button type="button" className={button} disabled={busy} onClick={() => resolve(entry, "reject")}>{t("yarvan.project.reject")}</button>
      </div>
    </div>)}
    {snapshot?.learned.map((entry) => <div key={entry.id} className="flex items-start justify-between gap-2 border-t border-hairline/30 py-2 text-[12px]">
      <div><p dir="auto">{entry.text}</p><p dir="auto" className="text-ink-secondary">{entry.quote}</p></div>
      <button type="button" className={button} disabled={busy} onClick={() => resolve(entry, "forget")}>{t("yarvan.project.forget")}</button>
    </div>)}
  </section>;
}
