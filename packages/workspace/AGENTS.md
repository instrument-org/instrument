# Workspace package

Core AI agents, workflow logic, RPC, and tools.

## Structure

- **RPC**: Router in `src/rpc/index.ts`. Handlers in `src/rpc/routes/`. Base and `toORPCError` in `src/rpc/base.ts`. Exposed to Studio as `workspaceRouter` via `@instrument-org/workspace/electron`.
- **Streaming**: every `eventIterator` procedure goes under `live.*` (snapshot on subscribe, then updates) or `events.*` (fires only on change), and nothing else does. A `live.*` mirror of a non-live procedure shares its leaf name: `task.byId` / `task.live.byId`.
- **Tools**: `src/tools/`. Build with `setupTool()` from `create-tool.ts`; register in `all.ts`. Use neverthrow `Result` for fallible logic; map to tool output or throw for oRPC.
- **Agents**: `src/agents/` (`all.ts`), wired by `create-agent.ts`, each picking its tools from `TOOLS`. `main` runs a task's session. `instrument` runs a chat's: it does one-step work itself and hands the rest to tasks it creates through the `task` shell command (`src/lib/shell-commands/task.ts`), which wake it when they finish (`src/lib/chat/wake.ts`). `agent-name-for-task.ts` says which answers in a task.
- **Workspace server**: loopback Hono app in `src/logic/server/index.ts`: the CDP bridge `agent-browser` drives a guest through, and the AI gateway mounted at `AI_GATEWAY_API_PATH` when provided. It serves no files: a page on this computer opens at its `file://` address for the person and the agent alike, and the person's viewers read files through Studio's own `instrument://computer-<token>` channel.
- **Schemas**: `src/schemas/`. Use for RPC/tool I/O where applicable.
- **Machines**: XState in `src/machines/`. `WorkspaceActorRef` is the main-process handle; RPC context gets `workspaceRef` and `workspaceConfig`.
- **Skills**: `src/lib/skills.ts` discovers them across the bundled set, the registry, co-installed agent homes, and the workspace `skills/` dir, deduping symlinks by canonical directory and copies by package fingerprint. `skill-catalog.ts` renders the budgeted catalog, which `available-skills-context.ts` puts in the session's context message (`LoadSkill`'s description is static, so installing a skill never rewrites a tool definition); `validate-skill.ts` holds the rules the runtime enforces. Each skill source mounts at `/skills/<source>/` for the agent, and only the workspace's own (`/skills/workspace/`) is writable (see `docs/architecture/agent-sandbox.md`).
- **Mount paths**: `src/mount-points.ts` holds `MOUNT`, the virtual paths the agent works in (`/task`, `/skills`, `/mnt`, `/apps`, `/tasks`). Interpolate it into prompts, tool descriptions, and command help rather than typing a path out, so what the agent is told cannot disagree with what it gets; `instrument/no-bare-mount-path` (`oxlint-rules.ts`) fails the lint on a literal anywhere under `src/`.

## Context messages

- `session-context` message (system prompt + `agent.getMessages`) is the session's immutable baseline: written once by `prepare-model-messages.ts` when the session first needs model input, then reused byte for byte, so the request prefix a provider cache is keyed on does not move.
- The single exception is an upgrade. Each stored baseline carries the `SESSION_CONTEXT_VERSION` it was written under, and one older than the running build's (or from before the marker existed) is replaced on the first turn after the upgrade, then reused like any other. Bump that constant when a change to `getMessages` has to reach tasks that already have a baseline stored, or those tasks never see it.
- So every `getMessages`-derived value (system date, project instructions, folder list, skill catalog, task layout) is a startup snapshot for the life of the session. A fact that must reach the model later is an **append-only correction**: a persisted `data-*` part rendered onto a user turn (`attached-folder-changes.ts`, `create-browser-status-part.ts`, `date-change.ts`), never an edit to an earlier message. Corrections must be deterministic to render from what is stored, so no live reads or timers during model-message conversion.
- Derive standing values from current state (`getEffectiveProjectContext`) so a value read at baseline time is not pinned to a snapshot that later parts already superseded.
- A correction recorded on an assistant message (`data-maxSteps`, `data-skillChanges`) is carried forward in `SessionMessage.toModelMessages` to the next user turn, since injection only runs for user messages.

## Evals

`pnpm eval` runs the real agent loop against real models (`evals/`, cases in `evals/cases/`). `--model` is required, start on Workers AI, and name the models you ran. The `workspace-evals` skill has the rest; the `validate-changes` skill says whether an eval is the right check at all.

## Seeded workspaces

`scripts/seed-workspace.ts` builds a throwaway app workspace from a committed
description in `fixtures/workspaces/` at the **repo root** (this package's own
`fixtures/` is something else), for `ELECTRON_USER_DATA_DIR`.
`scripts/record-fixture-session.ts` captures a real chat (with every task in it) or a lone task into one.

```bash
pnpm workspace:seed --list                                # from the repo root
pnpm workspace:seed --out <dir> --fixture documents [--fresh]
pnpm --filter @instrument-org/workspace script:record-fixture-session <chat-dir> --fixture <name> --chat <key> [--task-key <recorded>=<key>]...
pnpm --filter @instrument-org/workspace script:record-fixture-session <task-dir> --fixture <name> --task <key>
```

The seeder goes through `initializeTask` and `Store`, never the filesystem: task
storage is moving, and a seeder that lays out `tasks/<id>/.instrument` itself
would keep producing workspaces the app can no longer read.

The repo-root `fixtures/workspaces/README.md` covers what a fixture holds and how to add one.
