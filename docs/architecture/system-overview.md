# System overview

The top-level map of Instrument: the packages, how they layer, the processes at runtime, and how a task's work flows through them. Start here, then follow the links into subsystem docs.

Instrument is an Electron desktop app. The user works in **tasks**; an AI agent operates inside each task's per-task folder, can run the user's app, and drives an embedded browser to see and interact with it.

## Packages and layering

Dependencies point downward; nothing lower imports anything higher.

```
        studio (Electron app)        shim-client (injected runtime)
             \                       /
              workspace (agents, tools, server, runtimes)
                          |
                     ai-gateway (model proxy + model library)
                          |
                       shared (types, constants, utils)
```

- **`packages/shared`** — types, constants (e.g. `AI_GATEWAY_API_PATH`, `APP_NAME`), and utilities used everywhere.
- **`packages/ai-gateway`** — model access. A mounted Hono app that proxies provider API calls with injected credentials, plus a library for model discovery, identity, and image/web-search model construction. See [ai-gateway.md](ai-gateway.md).
- **`packages/workspace`** — the core: agents, tools, RPC, XState machines, the workspace HTTP server, and per-task runtimes. See [`packages/workspace/AGENTS.md`](../../packages/workspace/AGENTS.md).
- **`packages/shim-client`** — a separately built runtime injected into the user's app so Instrument can observe and drive it. Not yet mapped in its own doc; entry points are `packages/shim-client/src/{client,iframe}`, and the workspace server serves it (`shim-script` / `shim-iframe` routes).
- **`apps/studio`** — the Electron app (main process + React renderer) that hosts everything and is the product UI. See [`apps/studio/AGENTS.md`](../../apps/studio/AGENTS.md).

## Runtime topology

Two OS processes matter: Electron **main** and the **renderer**. Almost all server-side machinery runs in main; the renderer is UI only.

```
 renderer (React 19, TanStack Router)
    |  oRPC over MessageChannel
 main process (Electron)
    |-- Studio RPC routes + workspaceRouter
    |-- workspaceMachine (XState actor)
    |     |-- workspace HTTP server (Hono / @hono/node-server)
    |     |     |-- shim script + iframe, assets, heartbeat, CDP bridge
    |     |     |-- proxy of the user's app traffic
    |     |     `-- ai-gateway app mounted at AI_GATEWAY_API_PATH
    |     `-- per-task runtimes (runtimeRefs, keyed by TaskId)
    `-- browser view manager (embedded Chromium for the user's app)
```

- **Renderer ↔ main** is [oRPC](../../apps/studio/AGENTS.md) over a `MessageChannel`; the UI never calls remote services directly, only through main-process RPC. Main hosts Studio's own routes (`apps/studio/src/electron-main/rpc/routes/`) plus the workspace router (`workspaceRouter` from `@instrument-org/workspace/electron`).
- **Boot** happens in [`create-workspace-actor.ts`](../../apps/studio/src/electron-main/lib/create-workspace-actor.ts): it starts `workspaceMachine`, injecting `aiGatewayApp`, `shimClientDir`, the browser manager, `getAIProviderConfigs`, the on-disk model cache, and the registry/task-template directories.
- **Workspace server** is a Hono app served in-process via `@hono/node-server` ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)). It serves task files from a dedicated `assets.<task>.<host>` origin, plus the shim, heartbeat, CDP bridge, and ai-gateway app. The bare task origin retains the app-runtime proxy, runtime machine, and spawn path for future full-stack app viewing, but no current Studio UI navigates to it. The port falls back to a free one, so multiple dev instances can coexist.
- **Per-task runtimes** are XState actors the workspace machine supervises (`runtimeRefs`, keyed by `TaskId`); session/agent machines (`packages/workspace/src/machines/`) drive an agent turn within a task.
- **Sandboxing** of what the agent's tools can touch is a userland concern implemented inside each tool, not OS isolation. See [agent-sandbox.md](agent-sandbox.md).

## On-disk layout

Rooted at the workspace folder ([`get-workspace-folder`](../../apps/studio/src/electron-main/lib/get-workspace-folder.ts)):

- `tasks/<id>/` — one folder per task, with `.instrument/{task.db, state.json}` (per-task SQLite plus serialized state). Legacy layouts are normalized on boot by `migrateWorkspaceLayout`.
- `projects/` — project folders tasks reference.
- `registry/` — the skills submodule (read-only; never edited here).
- Model cache and `uv` data live under Electron's `userData`, not the workspace folder.

## An agent turn, end to end

1. The renderer sends a message via oRPC to the main process.
2. The workspace/session machine runs the agent, which selects tools per agent (`create-agent.ts`) and executes them against the task folder.
3. Model calls go through the ai-gateway app (credentials injected there, never in the renderer); model metadata/selection uses the ai-gateway library.
4. Results are persisted as message parts in the task's `task.db` and streamed back to the renderer over RPC.

## Deeper references

- [ai-gateway.md](ai-gateway.md) — model proxy and model library.
- [agent-sandbox.md](agent-sandbox.md) — how tool access is contained.
- [`packages/workspace/AGENTS.md`](../../packages/workspace/AGENTS.md) — RPC, tools, agents, machines, server.
- [`apps/studio/AGENTS.md`](../../apps/studio/AGENTS.md) — renderer, windows, RPC surface, where things live.
