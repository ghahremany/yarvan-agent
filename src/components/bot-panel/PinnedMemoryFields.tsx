// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import type { Ref } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PINNED_MEMORY_MAX_TEXT, PINNED_MEMORY_MAX_TITLE, type PinnedMemoryBlock } from "../../../shared/pinned-memory";
import type { BotProject } from "../../../shared/wire";
import { Select } from "../Select";
import { Field, inputCls } from "../bot-settings/field";

export function pinScopeLabel(projectId: string | undefined, projects: readonly BotProject[]) {
  return projectId ? projects.find((project) => project.id === projectId)?.name ?? t("memory.pinned.deletedProject") : t("memory.pinned.allChats");
}

export function PinnedMemoryFields({ draft, setDraft, projects, disabled, titleField, scopeLocked }: {
  draft: PinnedMemoryBlock;
  setDraft: (block: PinnedMemoryBlock) => void;
  projects: readonly BotProject[];
  disabled: boolean;
  scopeLocked?: boolean;
  titleField?: Ref<HTMLInputElement>;
}) {
  const unknown = draft.projectId && !projects.some((project) => project.id === draft.projectId);
  return <>
    <Field label={t("memory.pinned.blockTitle")}>
      <input ref={titleField} className={inputCls} dir="auto" maxLength={PINNED_MEMORY_MAX_TITLE} value={draft.title} disabled={disabled} required onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })} />
    </Field>
    <Field label={t("memory.pinned.blockText")}>
      <textarea className={cn(inputCls, "min-h-28 resize-y")} dir="auto" maxLength={PINNED_MEMORY_MAX_TEXT} value={draft.text} disabled={disabled} required onChange={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
    </Field>
    {(projects.length > 0 || unknown) && <Field label={t("memory.pinned.scope")}>
      <Select className="w-full" disabled={disabled || scopeLocked} value={draft.projectId ?? ""} onChange={(event) => setDraft({ ...draft, projectId: event.currentTarget.value || undefined })}>
        <option value="">{t("memory.pinned.allChats")}</option>
        {unknown && <option value={draft.projectId}>{t("memory.pinned.deletedProject")}</option>}
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Select>
    </Field>}
  </>;
}
