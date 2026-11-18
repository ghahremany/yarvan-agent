# Yarvan · یاروان

[Product page](https://ghahremany.github.io/yarvan-agent/?lang=en)

Yarvan is an independent, Apache-2.0, local-first derivative of the open-source edition of OpenMausBot. Run a roster of agents on a computer you control and choose the model behind each bot. This is a source release, not a vendor-hosted service or a desktop installer. [فارسی](README.md)

| Addition | How to use it |
| :--- | :--- |
| Project-only memory | Opt in when creating a project. New chats have a project notebook, scoped pins, lexical recall of their scope's conversations, and project-local learning with optional review. No tools or native session reuse in this mode. |
| Local hybrid retrieval | Opt in to a local Ollama embedding model. It ranks relevant notes alongside keyword results. Keyword search is still available without an embedder. |
| Private Telegram | Run an owner-allowlisted text DM bridge to a dedicated, memory-disabled bot. No owner-privileged key, groups, connected tools, or import from internal chats. |
| Teach in a browser | In a temporary browser, take control and record click, scroll and field-use markers. Review and edit the skill draft. It saves disabled, with no automatic replay or capture of typed values. |

## Run

Use Node.js 24 or later and pnpm 10.33.0. From the source directory:

```sh
corepack enable # or install pnpm 10.33.0 separately if Corepack is absent
pnpm install --frozen-lockfile --ignore-scripts
OMB_DATA_DIR="$HOME/.yarvan" OMB_DISABLE_ANNOUNCEMENTS=1 pnpm dev:server
```

Run `pnpm dev` in another terminal, open `http://127.0.0.1:5199`, and configure a model provider. The separate data directory is recommended when an upstream installation already exists. The `OMB_` names and API paths remain for compatibility. Connected model providers still receive the text needed to answer.

- [Setup and feature guide in Persian](docs/yarvan/guide-fa.md)
- [Architecture and data boundaries](docs/yarvan/architecture.md)
- [Verification and limitations](docs/yarvan/verification.md)
- [GitHub publication instructions](docs/yarvan/publish-fa.md)

See [LICENSE](LICENSE), [NOTICE](NOTICE), [UPSTREAM](UPSTREAM.md) and [CHANGELOG](CHANGELOG.md). Yarvan does not distribute the separately licensed Enterprise layer. Private bot configuration is not part of this repository.
