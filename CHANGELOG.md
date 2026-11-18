# Changelog

## Yarvan 0.1.0

- Add immutable project-only memory in single-owner workspaces: project notebook, scoped pins and recall, and a project-specific review queue. Forks retain the scope; moving an existing conversation across it is refused.
- Add opt-in loopback Ollama hybrid retrieval, bounded by source scope, with keyword fallback and no persistent vector index.
- Add a private Telegram DM worker with an allowlisted Telegram user, constrained local receiver, persistent update cursor and `/reset`. It is opt-in and refuses a key that acts as the owner.
- Add browser demonstration recording in a temporary browser and editable, disabled skill import. No frames or typed values are recorded.
- Retain the five personal memory controls from the personalized baseline. Remove the separately licensed Enterprise source and the upstream publication workflows from the public source snapshot.
