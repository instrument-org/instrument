# Workspace package

Core AI agents, workflow logic, RPC, tools, and runtime.

## Structure

- **RPC**: Router in `src/rpc/index.ts` (browser, debug, message, project, replay, runtime, session, task). Handlers in `src/rpc/routes/`. Base and `toORPCError` in `src/rpc/base.ts`. Exposed to Studio as `workspaceRouter` via `@instrument-org/workspace/electron`.
- **Tools**: `src/tools/`. Build with `setupTool()` from `create-tool.ts`; register in `all.ts`. Use neverthrow `Result` for fallible logic; map to tool output or throw for oRPC.
- **Agents**: `src/agents/`. `main` and `retrieval` in `all.ts`. Main agent runs the session; tools are selected per agent in `create-agent.ts`.
- **Workspace server**: Hono app in `src/logic/server/index.ts`. Serves shim script/iframe, assets, heartbeat, redirect, and proxies app traffic. AI gateway is mounted at `AI_GATEWAY_API_PATH` when provided.
- **Schemas**: `src/schemas/` (paths, subdomains, store-id, session, app-state, file-upload, etc.). Use for RPC/tool I/O where applicable.
- **Machines**: XState in `src/machines/` (workspace, session, agent). `WorkspaceActorRef` is the main-process handle; RPC context gets `workspaceRef` and `workspaceConfig`.

## Context messages

- `session-context` message (system prompt + `agent.getMessages`) persisted once
  per session, reused across turns. `prepare-model-messages.ts` rebuilds only when
  stale (`STALE_MESSAGE_THRESHOLD_MINUTES`, 60 min).
- So `getMessages`-derived values (project instructions, folder list, task layout)
  lag up to 60 min. Need-it-now changes: attach a per-turn `data-*` part to the user
  message (`detect-project-changes.ts`, `external-file-changes.ts`). Derive standing
  values from current state (`getEffectiveProjectContext`) so rebuild doesn't revert
  to a stale snapshot.

## Conventions

- Prefer neverthrow `Result` for fallible operations; use `toORPCError` when throwing from RPC handlers.
- Tools use Zod input/output schemas and the shared `create-tool` / `setupTool` pattern.
