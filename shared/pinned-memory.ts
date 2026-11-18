// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
export const PINNED_MEMORY_MAX_BLOCKS = 6;
export const PINNED_MEMORY_MAX_TITLE = 60;
export const PINNED_MEMORY_MAX_TEXT = 600;

export interface PinnedMemoryBlock {
  id: string;
  /** Absent means all eligible chats of this bot. */
  projectId?: string;
  title: string;
  text: string;
}

/** PUT replaces this bot's list only if the revision still matches. */
export interface PinnedMemorySnapshot {
  revision: string;
  blocks: PinnedMemoryBlock[];
}
