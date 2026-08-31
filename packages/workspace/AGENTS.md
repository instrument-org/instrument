# Workspace package

Core AI agents, workflow logic, RPC, tools, and runtime.

## Structure

- **RPC**: Router in `src/rpc/index.ts` (browser, debug, message, pin, project, replay, runtime, server, session, skill, storage, task). Handlers in `src/rpc/routes/`. Base and `toORPCError` in `src/rpc/base.ts`. Exposed to Studio as `workspaceRouter` via `@instrument-org/workspace/electron`.
- **Streaming**: every `eventIterator` procedure goes under `live.*` (snapshot on subscribe, then updates) or `events.*` (fires only on change), and nothing else does. A `live.*` mirror of a non-live procedure shares its leaf name: `task.byId` / `task.live.byId`.
- **Tools**: `src/tools/`. Build with `setupTool()` from `create-tool.ts`; register in `all.ts`. Use neverthrow `Result` for fallible logic; map to tool output or throw for oRPC.
- **Agents**: `src/agents/`. `main` is the only agent (`all.ts`); it runs the session and picks its tools from `TOOLS` in `main.ts`, wired by `create-agent.ts`.
- **Workspace server**: Hono app in `src/logic/server/index.ts`. Serves shim script/iframe, assets, heartbeat, redirect, the CDP bridge, and proxies app traffic. AI gateway is mounted at `AI_GATEWAY_API_PATH` when provided.
- **Schemas**: `src/schemas/` (paths, project, session, store-id, subdomain-part, task, task-settings, file-upload, folder-attachment, etc.). Use for RPC/tool I/O where applicable.
- **Machines**: XState in `src/machines/` (workspace, session, agent, runtime, task-browser). `WorkspaceActorRef` is the main-process handle; RPC context gets `workspaceRef` and `workspaceConfig`.
- **Skills**: `src/lib/skills.ts` discovers them across the bundled set, the registry, co-installed agent homes, and the workspace `skills/` dir, deduping symlinks by canonical directory and copies by package fingerprint. `skill-catalog.ts` renders the budgeted catalog, which `available-skills-context.ts` puts in the session's context message (`LoadSkill`'s description is static, so installing a skill never rewrites a tool definition); `validate-skill.ts` holds the rules the runtime enforces. The workspace `skills/` dir also mounts writable at `/skills` for the agent (see `docs/architecture/agent-sandbox.md`).
- **Mount paths**: `src/mount-points.ts` holds `MOUNT`, the four virtual paths the agent works in. Interpolate it into prompts, tool descriptions, and command help rather than typing a path out, so what the agent is told cannot disagree with what it gets; `no-bare-mount-path` (`eslint-rules.ts`) fails the lint on a literal anywhere under `src/`.

## Context messages

- `session-context` message (system prompt + `agent.getMessages`) is the session's immutable baseline: written once by `prepare-model-messages.ts` when the session first needs model input, then reused byte for byte, so the request prefix a provider cache is keyed on does not move.
- The single exception is an upgrade. Each stored baseline carries the `SESSION_CONTEXT_VERSION` it was written under, and one older than the running build's (or from before the marker existed) is replaced on the first turn after the upgrade, then reused like any other. Bump that constant when a change to `getMessages` has to reach tasks that already have a baseline stored, or those tasks never see it.
- So every `getMessages`-derived value (system date, project instructions, folder list, skill catalog, task layout) is a startup snapshot for the life of the session. A fact that must reach the model later is an **append-only correction**: a persisted `data-*` part rendered onto a user turn (`detect-project-changes.ts`, `create-pane-tabs-part.ts`, `date-change.ts`), never an edit to an earlier message. Corrections must be deterministic to render from what is stored, so no live reads or timers during model-message conversion.
- Derive standing values from current state (`getEffectiveProjectContext`) so a value read at baseline time is not pinned to a snapshot that later parts already superseded.
- A correction recorded on an assistant message (`data-maxSteps`, `data-skillChanges`) is carried forward in `SessionMessage.toModelMessages` to the next user turn, since injection only runs for user messages.

## Evals

`evals/` boots the real workspace machine and runs the actual agent loop against
real models. `evals/cases/` holds committed cases with assertions; `--prompt`
runs a throwaway one.

`pnpm eval` also exists at the repo root, so none of these need a `cd` first.

```bash
pnpm eval list                      # committed cases
pnpm eval run [pattern]             # run them
pnpm eval run --yes --prompt "..."  # one ad-hoc case
pnpm eval report <workspace-dir>    # re-report a past run, at no cost
```

Flags: `--model` (repeatable; bare slug means OpenRouter, full model URI pins any
configured provider), `--name`, `--repeat`, `--concurrency`, `--dry-run`,
`--include-context`, `--json`.

`run` and `report` exit non-zero when an assertion failed or a model request was
refused, so a failed suite is visible without reading the output. `--json` prints
the whole report as one line on stdout with all narration on stderr; the same
payload is always written to `summary.json` in the results directory, which is
the more reliable thing to script against. Color is emitted only to a terminal,
so a piped run needs no escape-stripping.

A run stops itself at `--max-run-tokens` (1M) or `--max-run-seconds` (1800), both
of which take `0` to disable. Neither is a failure and both are reported apart
from one: a stopped run is `Stopped`, only a refused request is `Failed`.

With no `--model`, a case runs against `MODELS` in `harness.ts`: the current
frontier model from each closed provider plus the strongest open-weights one, so
an affordance only one family finds shows up as a failure. Three are OpenRouter
`~author/<name>-latest` aliases, which move as new builds ship; the OpenAI entry
stays a pinned slug (`~openai/gpt-latest` resolves to the reasoning line rather
than what the app's auto setting sends users to) and is the one that needs a
bump by hand. The harness prints what each resolved to and records it as
`resolvedModelId` in the run's `eval-case.json`, since "latest" is not a build
anyone can identify a month later.

Results land in `eval-results.local/<timestamp>/<case>/<model>/` as `session.md`
(the rendered transcript), `stats.json`, `errors.json`, `assertions.json`, and
`eval-case.json`. Case and model name the path and every printed line, because a
seven-model run is otherwise twenty-one directories distinguished by a numeric
suffix. An approximate cost accompanies each run wherever the model's price is
known.

`summary.json` carries a `provenance` block so a directory can still say what it
measured months later: the commit and branch, whether tracked files differed from
it, and the sha256 of the system prompt each task was actually scored against
(also per task, in `eval-case.json`). The dirty flag is the one to read, because
measuring a prompt edit before committing it is the ordinary way a change gets
scored. More than one digest in a run means the session context was rebuilt part
way through and the tasks were not all scored against the same prompt. `report`
omits the commit, which would describe the checkout re-scoring rather than the
one that ran; the digest comes from the sessions and survives.

The workspace a run used is a temp directory, so `report <dir>` is only good
until the OS reaps it or the storage format moves past it. What lasts is
`eval-results.local`.

For choosing whether an eval is the right check at all, see the
`validate-changes` skill.

## Seeded workspaces

`scripts/seed-workspace.ts` builds a throwaway app workspace from a committed
description in `fixtures/workspaces/` at the **repo root** (this package's own
`fixtures/` is something else), for `ELECTRON_USER_DATA_DIR`.
`scripts/record-fixture-session.ts` captures a real task's conversation into one.

```bash
pnpm workspace:seed --list                                # from the repo root
pnpm workspace:seed --out <dir> --fixture documents [--fresh]
pnpm run script:record-fixture-session <task-dir-or.zip> --fixture <name> --task <key>
```

The seeder goes through `initializeTask` and `Store`, never the filesystem: task
storage is moving, and a seeder that lays out `tasks/<id>/.instrument` itself
would keep producing workspaces the app can no longer read.

The repo-root `fixtures/workspaces/README.md` covers what a fixture holds and how to add one.
