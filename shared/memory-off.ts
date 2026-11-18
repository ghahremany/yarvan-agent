// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
export function supportsMemoryOff(driverKind: string | undefined): boolean {
  // App-mounted tools can all be omitted on these adapters. Do not guess what third-party coding agents load from disk.
  return driverKind !== undefined && ["claudeAgent", "openai-compat", "grok", "minimax", "mistral", "cerebras", "groq", "greenference", "modelgo", "meta"].includes(driverKind);
}
