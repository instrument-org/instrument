---
name: validate-changes
description: Choose how to check an Instrument change — sandbox shell, tool harness, a real agent across models, or the running app. Use after changing an agent tool, a prompt, a skill, the sandbox, or any behavior reading the code cannot confirm.
---

# Validating a change

Four ways to run this product, cheapest first. Each rung is slower and less
convenient than the one below it, and answers a question the ones below it
cannot. **Start at the lowest rung that can actually answer your question, then
stop.**

| Rung             | Runs                     | Agent | Model calls | Answers                 |
| ---------------- | ------------------------ | ----- | ----------- | ----------------------- |
| 1. Unit tests    | pure functions, machines | no    | no          | is the logic right      |
| 2. Sandbox shell | `just-bash` + shims      | no    | no          | does the command behave |
| 3. Real agent    | full agent loop          | yes   | yes         | does a model _use_ it   |
| 4. Studio        | the whole app            | yes   | yes         | does it work for a user |

The trap is stopping one rung too low and reporting the rung above's
conclusion. Rungs 1 and 2 have no model in them: you pick the inputs, so they can tell you a
mechanism works but never that an agent will find it, understand the tool
description, or choose the right arguments. Only rung 3 answers that.

## What did you change?

- **A pure function, a schema, an XState machine** -> rung 1.
- **A shell command, a shim, sandbox paths, network policy** -> rung 2.
- **A tool's inputs, output, or `toModelOutput` text** -> rung 3, because that
  text only matters if a model acts on it correctly.
- **A tool description, a system prompt, a skill, tool selection** -> rung 3
  only. There is nothing below it that involves a model, so nothing below it can
  answer the question.
- **Anything the user sees** -> rung 4.

## Rung 1: unit tests

```bash
cd packages/workspace && pnpm test run <path/to/file.test.ts>
```

Root-level checks (`pnpm exec turbo run check:types check:lint`) are in the root
`AGENTS.md`.

## Rung 2: the sandbox shell

Boots the same `just-bash` sandbox the agent gets (same virtual FS, same command
shims, same network policy) without Studio.

```bash
cd packages/workspace && pnpm --silent script:run-bash -- "<command>"
```

Full options, mounts, and what the sandbox provides: `run-bash` skill.

## Rung 3: a real agent, on real models

Boots the real workspace machine and runs the agent loop against real models.
This is the only rung that tells you whether a model finds and uses what you
built.

```bash
pnpm eval run --yes --prompt "<task for the agent>" --model anthropic/claude-haiku-4.5
```

- Runs from the repo root; no `cd` first.
- `--model` repeats to build a case x model matrix. Different models fail
  differently; one model succeeding is weak evidence. `--repeat` samples the
  same model more than once, which is what a nondeterministic result needs.
- A bare slug reads as OpenRouter. Pass a full model URI
  (`<model>?provider=<p>&providerConfigId=<p>-config-id`) to pin another
  configured provider.
- Each run prints the path to a rendered `session.md`, filed under
  `<case>/<model>`. **Read it.** The tool sequence is the result; the agent's
  closing summary is not.
- Check the summary's failed-request line before trusting anything: a run that
  dies on a rate limit still produces a task and a transcript. A run reported as
  `Stopped` is not that: the harness or the case ended it on purpose.
- Exit status is non-zero when an assertion failed or a request was refused, so
  the run does not have to be read to know whether it passed. `--json` and the
  `summary.json` beside the results carry the same verdict per case and model.
- Changing an assertion costs nothing to re-check: `pnpm eval report <workspace
  dir>` re-runs every assertion against the sessions already recorded. The run
  prints the exact command to use.

Committed cases live in `packages/workspace/evals/cases/`; add one when a
behavior is worth guarding permanently. Details in
`packages/workspace/AGENTS.md`.

## Rung 4: the running app

```bash
pnpm dev:studio
```

Hot reloads all three targets, including main-process changes. Then:

- Drive it or inspect the DOM: `studio-chrome-devtools` skill (CDP on port
  48160).
- Read main-process logs: `studio-dev-logs` skill.
- Headless or in a VM: `.agents/cloud-dev.md`.

## Inspecting a run afterwards

- `session-transcript` skill — render any task's session as markdown, including
  one from an exported `.zip`. This is also how you read a real user's run.
- `task-database-query` skill — read-only SQL against a task's `task.db` when
  the transcript is not enough.
- `find-ui-changes` skill — which recent commits changed user-visible surfaces.
