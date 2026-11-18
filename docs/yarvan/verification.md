# Verify Yarvan

From a fresh checkout of the public source, with Node.js 24 and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm i18n:check
pnpm test:yarvan
pnpm test:yarvan:bundle
```

The GitHub workflow runs the same checks with read-only repository permissions; no deployment credentials are needed. The smoke command bundles the OSS server and boots it in a throwaway directory. It checks the health endpoint, the `oss` edition and the Yarvan brand without reading any existing workspace. The bundle smoke does not build a desktop installer or type-check the full application.

## What the tests check

- **Project memory:** Real loopback server, fake Claude CLI. Inspect what actually reached the model process from a project notebook, project-only pins, a reviewed note and a sibling transcript. Verify the absence of that context in ordinary, other-project and memory-off chats. Check fork text replay and inability to reuse a native session or move a scoped task. Exercise source review, expiry, forget, revision conflicts, internal transcript refusal and project deletion rules.
- **Hybrid retrieval:** A loopback HTTP fixture speaks the Ollama embedding contract. A Persian paraphrase retrieves the expected note; failed or malformed embeddings fall back to keywords. Tests assert scope- and edit-aware vector cache keys. This does not measure a model's retrieval quality.
- **Telegram:** The actual loopback endpoint rejects the wrong key, a forwarded request, an owner-privileged key and thread crossover with the generic Bot API. Inspect fresh no-tools execution and DM-only replay. A mock Telegram API verifies the sender gate, reset, cursor and approval refusal. No real Telegram token was used.
- **Browser demonstration:** The React/DOM test drives takeover, start, stop, editing, save and relinquishing control with a stub viewer transport. It inspects the exact API payload for absence of typed text and full URLs. The actual server endpoint rejects an enabled draft and saves a disabled one. No native browser video or protocol integration is certified by this test.
- **Regression coverage:** The existing regular-chat, memory-off, room and pin tests, the generic Bot API and its permissions, and frontend memory actions are also checked.

## Limits of release verification

This is a source release for a single-owner setup. The release environment did not verify a live Ollama model or Telegram account, a native installer, or the full live-browser stream. Full application/server TypeScript checks reached the sandbox time limit; the production Vite build exceeded the available memory. Those checks are **not** reported as passing. TypeScript verification of the phone protocol, source-level tests and the separate OSS server bundle/boot checks do not replace them. On a machine with more memory use `pnpm typecheck` and `pnpm exec vite build` for the full checks.

See [the manual instructions](guide-fa.md) for provider quality, a real bot token and an actual browser session on your machine.
