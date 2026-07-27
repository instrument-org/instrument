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

## Conventions

- Prefer neverthrow `Result` for fallible operations; use `toORPCError` when throwing from RPC handlers.
- Tools use Zod input/output schemas and the shared `create-tool` / `setupTool` pattern.

## Evals

`evals/` boots the real workspace machine and runs the actual agent loop against
real models. `evals/cases/` holds committed cases with assertions; `--prompt`
runs a throwaway one.

```bash
pnpm eval list                      # committed cases
pnpm eval run [pattern]             # run them
pnpm eval run --yes --prompt "..."  # one ad-hoc case
pnpm eval report <workspace-dir>    # re-report a past run
```

Flags: `--model` (repeatable; bare slug means OpenRouter, full model URI pins any
configured provider), `--name`, `--concurrency`, `--dry-run`, `--include-context`.

Results land in `eval-results.local/<timestamp>/<task>/` as `session.md` (the
rendered transcript), `stats.json`, `errors.json`, and `assertions.json`.

For choosing whether an eval is the right check at all, see the
`validate-changes` skill.
