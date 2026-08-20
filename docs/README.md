# Repository knowledge base

This repository treats versioned documentation as the system of record for architecture, decisions, findings, plans, and product review evidence. `AGENTS.md` is the map; the documents here hold the detail.

The structure is inspired by OpenAI's [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/), especially its guidance to keep repository knowledge structured, discoverable, and progressively disclosed. Link to the canonical article rather than vendoring a copy so its authorship and updates remain clear; this repository records the local conventions we actually depend on.

## Sections

Each has its own README carrying the section's conventions and a full index of its files.

| Section | What belongs there | Shape |
| --- | --- | --- |
| [`architecture/`](architecture/README.md) | How the system works today | Evergreen, edited in place, no dates |
| [`decisions/`](decisions/README.md) | Why we chose one approach over another | Dated, never rewritten, superseded instead |
| [`findings/`](findings/README.md) | Non-obvious issues, what we tried, what might resolve them | Carries a `**Status:**` line |
| [`plans/`](plans/README.md) | Execution plans for non-trivial work | Carries a `Status:` line; `active/` then `completed/` |
| [`changes/`](changes/README.md) | Screenshot-backed summaries of user-facing changes | Dated snapshots, preserved as written |

The distinction that matters most: **architecture is corrected, decisions and changes are superseded.** If an architecture doc says something no longer true, fix the sentence. If a decision turned out wrong, write a new dated one that references it and add a pointer to the old one — the original reasoning stays intact, because the reason a choice looked right at the time is the thing worth keeping.

## Keeping it honest

- A `Status:` line is the first thing a reader checks and the first thing to go stale. When work lands, update the plan or finding that describes it in the same change.
- Prefer specifics over labels: "phases 1-3 landed, phase 4 not started" beats "in progress".
- Link code paths so a doc stays tied to the source, and fix the links when files move. Nothing in `docs/` should point at a path that no longer exists.
- Leave out anything tied to one machine, person, or moment: local paths, sibling checkout names, branch names, in-flight PR state.

## Not tracked here

`visual-explanations/` is gitignored. Generated HTML explainers land there for local reading and are deliberately not versioned, so the directory is empty in a fresh clone.

Documentation for the Platform API, the authenticated service Studio calls through `src/electron-main/platform-api/`, belongs in that service's own repository rather than here. Describe this side of the seam freely: the client interface, what the app does with a response, and what a failure has to look like to the user. Leave the endpoint's design, provider choices, pricing, and billing to the side that owns them, so those details have one home and cannot drift into a second description that nobody updates.
