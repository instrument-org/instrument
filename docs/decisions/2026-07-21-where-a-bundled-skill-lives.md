# A bundled skill lives in the registry only if another agent could use it

Date: 2026-07-21

## Context

We ship skills from two directories that the user sees as one. `registry/skills` is the `instrument-org/skills` submodule; `packages/workspace/system-skills` is bundled into the asar by `electron-builder.ts`. Both carry a `SkillSourceKind` that Studio groups under a single "Provided by Instrument" heading, so which of the two a skill sits in is invisible to the user and is purely a question of how we maintain it.

`skill-creator` is the only skill in `system-skills`, which raised the question of whether it belongs in the registry and the bundled directory should go away.

## Decision

The registry holds skills that would work for any agent. The bundled directory holds skills that only make sense inside Instrument.

`skill-creator` stays bundled. It teaches authoring against our layout: the writable `/skills` mount, the frontmatter we read, the check-before-overwrite rule that moved out of `save_skill`. None of that transfers.

## Why

The registry is a separate repository because its contents are meant to be worth something outside this app. `docx`, `pdf`, `ffmpeg`, and `sharp-images` are all skills anyone could install. A skill that encodes our filesystem layout is a maintenance liability there: it would be the one entry a reader has to know to skip, and it would drag our internals into a repo whose value is that it has none.

Keeping it bundled also removes a runtime dependency. `system-skills` ships inside the app; the registry is a submodule that may be uninitialized in a fresh checkout, and skill authoring should not be the thing that breaks when it is.

## Consequences

- The bundled directory stays, with one skill in it. That is the correct size for it, not a sign it is vestigial.
- `agent-browser` currently sits in the registry despite being ours. It is moving toward vanilla CDP, so it is expected to earn its place rather than be relocated.
- "system-skills" names the mechanism (bundled, not fetched) rather than the rule above, which is portability. The name is developer-facing only, so it is not worth the packaging and config churn to change on its own; fold it into the next change that touches `systemSkillsDir` if one comes.
