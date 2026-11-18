// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
/** Context OpenMausBot supplied at dispatch, not an attribution of the model's answer. */
export interface ReplyMemoryItem {
  kind: "pin" | "notebook" | "recall" | "conversation" | "profile" | "team";
  label: string;
  text: string;
  pinId?: string;
  file?: string;
}

export interface ReplyMemoryContext {
  mode: "on" | "off";
  items: ReplyMemoryItem[];
}
