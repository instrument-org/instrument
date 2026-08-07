# Workspace package

Core AI agents, workflow logic, RPC, tools, and runtime.

## Structure

- **RPC**: Router in `src/rpc/index.ts` (browser, debug, message, pin, project, replay, runtime, server, session, skill, storage, task). Handlers in `src/rpc/routes/`. Base and `toORPCError` in `src/rpc/base.ts`. Exposed to Studio as `workspaceRouter` via `@instrument-org/workspace/electron`.
- **Tools**: `src/tools/`. Build with `setupTool()` from `create-tool.ts`; register in `all.ts`. Use neverthrow `Result` for fallible logic; map to tool output or throw for oRPC.
- **Agents**: `src/agents/`. `main` is the only agent (`all.ts`); it runs the session and picks its tools from `TOOLS` in `main.ts`, wired by `create-agent.ts`.
- **Workspace server**: Hono app in `src/logic/server/index.ts`. Serves shim script/iframe, assets, heartbeat, redirect, and proxies app traffic. AI gateway is mounted at `AI_GATEWAY_API_PATH` when provided.
- **Schemas**: `src/schemas/` (paths, project, session, store-id, subdomain-part, task, task-settings, file-upload, folder-attachment, etc.). Use for RPC/tool I/O where applicable.
- **Machines**: XState in `src/machines/` (workspace, session, agent, runtime, task-browser). `WorkspaceActorRef` is the main-process handle; RPC context gets `workspaceRef` and `workspaceConfig`.
- **Skills**: `src/lib/skills.ts` discovers them across the bundled set, the registry, co-installed agent homes, and the workspace `skills/` dir, deduping symlinks by canonical directory and copies by package fingerprint. `skill-catalog.ts` renders the budgeted catalog into `LoadSkill`'s description; `validate-skill.ts` holds the rules the runtime enforces. The workspace `skills/` dir also mounts writable at `/skills` for the agent (see `docs/architecture/agent-sandbox.md`).

## Context messages

- `session-context` message (system prompt + `agent.getMessages`) persisted once per session, reused across turns. `prepare-model-messages.ts` rebuilds only when stale (`STALE_MESSAGE_THRESHOLD_MINUTES`, 60 min).
- So `getMessages`-derived values (project instructions, folder list, task layout) lag up to 60 min. Need-it-now changes: attach a per-turn `data-*` part to the user message (`detect-project-changes.ts`, `external-file-changes.ts`). Derive standing values from current state (`getEffectiveProjectContext`) so rebuild doesn't revert to a stale snapshot.

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
an affordance only one family finds shows up as a failure. Those are OpenRouter
`~author/<name>-latest` aliases, which move as new builds ship and therefore need
no edit here. The harness prints what each resolved to and records it as
`resolvedModelId` in the run's `eval-case.json`, since "latest" is not a build
anyone can identify a month later.

Results land in `eval-results.local/<timestamp>/<case>/<model>/` as `session.md`
(the rendered transcript), `stats.json`, `errors.json`, `assertions.json`, and
`eval-case.json`. Case and model name the path and every printed line, because a
seven-model run is otherwise twenty-one directories distinguished by a numeric
suffix. An approximate cost accompanies each run wherever the model's price is
known.

For choosing whether an eval is the right check at all, see the
`validate-changes` skill.

## Seeded workspaces

`scripts/seed-workspace.ts` builds a throwaway app workspace from a committed
description in `fixtures/workspaces/`, for `ELECTRON_USER_DATA_DIR`.
`scripts/record-fixture-session.ts` captures a real task's conversation into one.

```bash
pnpm workspace:seed --list                                # from the repo root
pnpm workspace:seed --out <dir> --fixture documents [--fresh]
pnpm run script:record-fixture-session <task-dir-or.zip> --fixture <name> --task <key>
```

The seeder goes through `initializeTask` and `Store`, never the filesystem: task
storage is moving, and a seeder that lays out `tasks/<id>/.instrument` itself
would keep producing workspaces the app can no longer read.

`fixtures/workspaces/README.md` covers what a fixture holds and how to add one.
