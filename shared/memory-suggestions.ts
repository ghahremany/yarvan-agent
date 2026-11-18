// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
export const MAX_PENDING_MEMORY_SUGGESTIONS = 40;

export interface MemorySuggestion {
  id: string;
  text: string;
  /** An excerpt of the source sentence, verified against the conversation. */
  quote: string;
  threadId: string;
  at: number;
  via: "capture" | "dream";
  until?: string;
  replaces?: string;
}

export interface MemorySuggestionQueue {
  enabled: boolean;
  pending: MemorySuggestion[];
}
