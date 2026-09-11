# System overview

The top-level map of Instrument: the packages, how they layer, the processes at runtime, and how a task's work flows through them. Start here, then follow the links into subsystem docs.

Instrument is an Electron desktop app. The user works in **tasks**; an AI agent operates inside each task's per-task folder, can run the user's app, and drives an embedded browser to see and interact with it.

## Packages and layering

Dependencies point downward; nothing lower imports anything higher.

```
        studio (Electron app)
             |
        workspace (agents, tools, server)
             |
        ai-gateway (model proxy + model library)
             |
        shared (types, constants, utils)
```

- **`packages/shared`** — types, constants (e.g. `AI_GATEWAY_API_PATH`, `APP_NAME`), and utilities used everywhere.
- **`packages/ai-gateway`** — model access. A mounted Hono app that proxies provider API calls with injected credentials, plus a library for model discovery, identity, and image/web-search model construction. See [ai-gateway.md](ai-gateway.md).
- **`packages/workspace`** — the core: agents, tools, RPC, XState machines, and the workspace HTTP server. See [`packages/workspace/AGENTS.md`](../../packages/workspace/AGENTS.md).
- **`apps/studio`** — the Electron app (main process + React renderer) that hosts everything and is the product UI. See [`apps/studio/AGENTS.md`](../../apps/studio/AGENTS.md).

## Runtime topology

Two OS processes matter: Electron **main** and the **renderer**. Almost all server-side machinery runs in main; the renderer is UI only.

```
 renderer (React 19, TanStack Router)
    |  oRPC over MessageChannel
 main process (Electron)
    |-- Studio RPC routes + workspaceRouter
    |-- workspaceMachine (XState actor)
    |     `-- workspace HTTP server (Hono / @hono/node-server)
    |           |-- per-task asset origin, CDP bridge
    |           `-- ai-gateway app mounted at AI_GATEWAY_API_PATH
    |-- file channel (instrument://computer-<token>, the renderer's own read of any file on the computer)
    `-- browser view manager (embedded Chromium guests the agent and the person browse in)
```

- **Renderer ↔ main** is [oRPC](../../apps/studio/AGENTS.md) over a `MessageChannel`; the UI never calls remote services directly, only through main-process RPC. Main hosts Studio's own routes (`apps/studio/src/electron-main/rpc/routes/`) plus the workspace router (`workspaceRouter` from `@instrument-org/workspace/electron`).
- **Boot** happens in [`create-workspace-actor.ts`](../../apps/studio/src/electron-main/lib/create-workspace-actor.ts): it starts `workspaceMachine`, injecting `aiGatewayApp`, the browser manager, `getAIProviderConfigs`, the on-disk model cache, the registry / system-skills / task-template directories, the bundled `pnpm` and `uv` binary paths (plus uv's data dir), the `external_browser` flag getter, and the web-search client.
- **Workspace server** is a Hono app served in-process via `@hono/node-server` ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)), and everything on it is for the agent: the `assets.<task>.<host>` origin its browser opens a task's files on ([asset-origin.md](asset-origin.md)), the CDP bridge `agent-browser` drives a guest through, and the ai-gateway app every in-process model call is pointed at. The port falls back to a free one, so multiple dev instances can coexist.
- **The file channel** is how the person's own viewers read a file: `instrument://computer-<token>/<host path>`, an app-scheme handler in main ([`computer-files.ts`](../../apps/studio/src/electron-main/lib/computer-files.ts)) that serves any file the app's user can read, by its real path. It is registered on the app's own session only, so no browser guest can name it, and the host carries a per-launch token the renderer learns over RPC, so agent-authored HTML in the artifact preview cannot either.
- **Session and agent machines** (`packages/workspace/src/machines/`) drive an agent turn within a task; the workspace machine supervises them per task.
- **Sandboxing** of what the agent's tools can touch is a userland concern implemented inside each tool, not OS isolation. See [agent-sandbox.md](agent-sandbox.md).

## On-disk layout

Rooted at the workspace folder ([`get-workspace-folder`](../../apps/studio/src/electron-main/lib/get-workspace-folder.ts)):

- `tasks/<id>/` — one folder per task, with `.instrument/{task.db, settings.json}` (per-task SQLite plus one JSON record: what the app knows about the task at the top level, where the user left off under `state`). Legacy layouts are normalized on boot by `migrateWorkspaceLayout`.
- `projects/` — project folders tasks reference.
- `skills/` — user-authored and imported skills, mounted writable into the agent at `/skills`. Skills discovered elsewhere on the machine (co-installed agent homes like `~/.claude` and its peers, enumerated by `getSkillSources` in `packages/workspace/src/lib/skills.ts`) stay where they are.
- The bundled skills registry is **not** here: `registryDir` points at the `registry/` git submodule in development and at the app's `resources/` when packaged, read-only either way, with the bundled system skills (`systemSkillsDir`) beside it.
- Model cache and `uv` data live under Electron's `userData`, not the workspace folder.

## An agent turn, end to end

1. The renderer sends a message via oRPC to the main process.
2. The workspace/session machine runs the agent, which selects tools per agent (`create-agent.ts`) and executes them against the task folder.
3. Model calls go through the ai-gateway app (credentials injected there, never in the renderer): the user's own provider keys, plus a first-party provider config synthesized from their auth token when they are signed in. Model metadata/selection uses the ai-gateway library.
4. Results are persisted as message parts in the task's `task.db` and streamed back to the renderer over RPC.
5. Stopping walks the same chain in reverse: session → agent → the in-flight `executeToolCallMachine`, which writes its own "stopped by you" part before the agent finishes. Cancellation is owned by whichever machine holds the work, because leaving a state that invokes a child hard-stops that child before it can react. In `Finishing`, after `onFinish` has persisted what the turn produced, the agent sweeps any of the run's tool parts still in `input-*` (queued siblings, inputs an aborted stream saved, pending interactive calls) to `output-error`, so no call is left dangling in the record. A turn that ends with both queues drained and no stop skips the sweep, since nothing of it can be dangling.

## Deeper references

- [ai-gateway.md](ai-gateway.md) — model proxy and model library.
- [agent-sandbox.md](agent-sandbox.md) — how tool access is contained.
- [in-app-browser.md](in-app-browser.md) — the per-task browser the agent and user share.
- [`packages/workspace/AGENTS.md`](../../packages/workspace/AGENTS.md) — RPC, tools, agents, machines, server.
- [`apps/studio/AGENTS.md`](../../apps/studio/AGENTS.md) — renderer, windows, RPC surface, where things live.
