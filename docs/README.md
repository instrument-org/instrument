# Repository knowledge base

This repository treats versioned documentation as the system of record for architecture, decisions, findings, plans, and product review evidence. `AGENTS.md` is the map; the documents here hold the detail.

The structure is inspired by OpenAI's [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/), especially its guidance to keep repository knowledge structured, discoverable, and progressively disclosed. Link to the canonical article rather than vendoring a copy so its authorship and updates remain clear; this repository records the local conventions we actually depend on.

- `architecture/` contains evergreen descriptions of how the system works today.
- `decisions/` preserves dated rationale for choices that should not be rewritten after the fact.
- `findings/` records durable, non-obvious engineering observations and unresolved issues.
- `plans/` tracks non-trivial execution work from active through completed.
- `changes/` captures dated, screenshot-backed summaries of user-facing changes for design follow-up and possible changelog input.

Documentation for the Platform API, the authenticated service Studio calls through `src/electron-main/platform-api/`, belongs in that service's own repository rather than here. Describe this side of the seam freely: the client interface, what the app does with a response, and what a failure has to look like to the user. Leave the endpoint's design, provider choices, pricing, and billing to the side that owns them, so those details have one home and cannot drift into a second description that nobody updates.
