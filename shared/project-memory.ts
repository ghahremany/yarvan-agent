export const PROJECT_ONLY = "project-only" as const;
export const PROJECT_TEXT_LIMIT = 12_000;

export interface ProjectMemoryEntry {
  id: string;
  text: string;
  quote: string;
  threadId: string;
  at: number;
  until?: string;
}

export interface ProjectMemorySnapshot {
  revision: string;
  text: string;
  learned: ProjectMemoryEntry[];
  pending: ProjectMemoryEntry[];
}

export function isolatedTask(task?: { memoryOff?: true; projectMemory?: true; telegramPrivate?: true } | null): boolean {
  return task?.memoryOff === true || task?.projectMemory === true || task?.telegramPrivate === true;
}

export function movableProjectFolders<T extends { id: string; memoryMode?: typeof PROJECT_ONLY }>(
  task: { projectId?: string; projectMemory?: true; telegramPrivate?: true }, folders: readonly T[] = [],
): T[] {
  if (task.projectMemory || task.telegramPrivate || folders.some((folder) => folder.id === task.projectId && folder.memoryMode === PROJECT_ONLY)) return [];
  return folders.filter((folder) => folder.memoryMode !== PROJECT_ONLY);
}
