# System overview

The top-level map of Instrument: the packages, how they layer, the processes at runtime, and how a task's work flows through them. Start here, then follow the links into subsystem docs.

Instrument is an Electron desktop app. The user talks to it in **chats**. A chat runs the chat's agent (agent `instrument`, [`agents/instrument.ts`](../../packages/workspace/src/agents/instrument.ts)), which does one-step work itself and starts, steers, and stops **tasks** through its `task` command for the rest, connects the user's **apps**, and keeps **memory** about the user. Each task runs agent `main` ([`agents/main.ts`](../../packages/workspace/src/agents/main.ts)) in its own folder, with a shell, file tools, the web, the user's apps, and an embedded browser it drives to see and interact with pages.

## Chats, tasks, and the window

- **The app window** ([`windows/app-window.ts`](../../apps/studio/src/electron-main/windows/app-window.ts)) carries app-level tabs across its bar, each a TanStack router of its own kept mounted in one web contents ([`app-tabs.ts`](../../apps/studio/src/client/components/window/app-tabs.ts)). A tab holds a chat or the inbox, Apps, Files, a site, the browser, or a skill; its screens are the routes under [`client/routes/_app/`](../../apps/studio/src/client/routes/_app). A small onboarding window runs before it on first run. See [`apps/studio/AGENTS.md`](../../apps/studio/AGENTS.md#windows).
- **A chat's tabs** (and a draft's, and the one page of a site at the window's level) are groups in one more model: `{ activeByGroup, tabs }`, changed only through the pure reducers in [`tab-model.ts`](../../apps/studio/src/client/components/window/tab-model.ts) and read through [`window-tabs.ts`](../../apps/studio/src/client/components/window/window-tabs.ts). The group on screen is never stored; it is whatever chat or site the window's tab up stands on. A chat's group, like its `/chats/<id>` address, is keyed by its chat id; every other group's key has a colon in it, which no chat id does. A page tab is a browser guest of the window's own; a screen tab is a route of the same tree under a router of its own ([`use-group-tab-routers.ts`](../../apps/studio/src/client/hooks/use-group-tab-routers.ts)), which a route component tells apart from a window tab only by `useGroupTab()`. Back and forward everywhere (the window's arrows and chords, a row's arrows, thumb buttons, a page's menu) walk one rule, `stepOf` in [`tab-steps.ts`](../../apps/studio/src/client/components/window/tab-steps.ts): the page's own history, then the screen's router, then the tab's visits across pages and screens, then, for a site, the window tab's history. Where an open lands is [`placement.ts`](../../apps/studio/src/client/components/window/placement.ts).
- **The inbox** (`/chats`) is the chat list beside an open chat, mail-shaped: one row per chat, opened in place ([`inbox-room.ts`](../../apps/studio/src/client/components/window/inbox-room.ts) decides when it steps aside for a narrow row).
- **Topics** are tags on chats, each a folder under `topics/` with standing instructions and the folders its work uses ([`chat/topics.ts`](../../packages/workspace/src/lib/chat/topics.ts)). Every chat filed under a topic is read with its instructions.
- **Apps** are the user's connected services: one folder per app under `apps/` holding an `app.json` manifest and a guide, never a secret ([`lib/apps/`](../../packages/workspace/src/lib/apps)). Credentials and OAuth state live in workspace stores in main ([`lib/apps.ts`](../../apps/studio/src/electron-main/lib/apps.ts)). The chat's agent authors and connects them; a task reaches the ones it was handed through the `app` command, and an app event can wake the chat. Several apps can be one service, like two Gmail accounts: the manifest's `service` names the directory entry they share (`catalogEntryForApp` finds it by slug or address when the manifest does not say), and each one's `account` tells them apart.
- **Chat wiring** ([`chat/attach.ts`](../../packages/workspace/src/lib/chat/attach.ts)) is attached once per workspace actor: it gives the `task` command its route to the machine, wakes a chat when a child task finishes or an app event lands, and retitles a chat after its first exchange.

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
    |           |-- CDP bridge
    |           `-- ai-gateway app mounted at AI_GATEWAY_API_PATH
    |-- file channel (instrument://computer-<token>, the renderer's own read of any file on the computer)
    `-- browser view manager (embedded Chromium guests the agent and the person browse in)
```

- **Renderer ↔ main** is [oRPC](../../apps/studio/AGENTS.md) over a `MessageChannel`; the UI never calls remote services directly, only through main-process RPC. Main hosts Studio's own routes (`apps/studio/src/electron-main/rpc/routes/`) plus the workspace router (`workspaceRouter` from `@instrument-org/workspace/electron`).
- **How the UI learns of changes.** A `live.*` route reads once, then again after each burst of changes it subscribed to before that first read (`liveRead` in [`live-read.ts`](../../packages/workspace/src/rpc/live-read.ts)). For records, the change is `record.changed { id, kind }` ([`record-changes.ts`](../../packages/workspace/src/lib/record-changes.ts)), published where the change is made rather than by its caller: every write through a task's storage handle (`messages` or `session`), the record writer (`settings` or `state`), the session actor and the hold registry (`agent`), and trashing (`removed`, carrying the `RecordRef` since the index has already forgotten it). The chat list keeps its rows and reads again only the chats a batch of changes moved, plus every row when the apps change; one task's working, hold, step and newest session is `task.live.status`. Transcripts still batch `message.*` / `part.updated` by message id. Studio main never holds the workspace's event bus: it hears through `appListChanges` and `sessionEnds` and tells through `appChanged`, which publishes `app.updated` and `app.event` together.
- **Boot** happens in [`create-workspace-actor.ts`](../../apps/studio/src/electron-main/lib/create-workspace-actor.ts): it runs `migrateWorkspaceLayout` over the workspace folder, starts the bash worker every agent shell runs in, then starts `workspaceMachine`, injecting `aiGatewayApp`, the apps config, the browser manager, `getAIProviderConfigs`, the signed-in user, the on-disk model cache, the registry / system-skills / prepared-skills / task-template directories, the search index dir, the bundled `pnpm` and `uv` binary paths (plus uv's data dir), the feature-flag getters, and the web-search client, and attaches the chat wiring (`attachChats`).
- **Workspace server** is a Hono app served in-process via `@hono/node-server` ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)), and everything on it is for the agent: the CDP bridge `agent-browser` drives a guest through, and the ai-gateway app every in-process model call is pointed at. It serves no files: a page on the computer opens at its `file://` address for the agent as for the person ([in-app-browser.md](in-app-browser.md#a-file-on-the-computer-has-one-address-for-the-person-and-the-agent)). The port falls back to a free one, so multiple dev instances can coexist.
- **The file channel** is how the person's own viewers read a file: `instrument://computer-<token>/<host path>`, an app-scheme handler in main ([`computer-files.ts`](../../apps/studio/src/electron-main/lib/computer-files.ts)) that serves any file the app's user can read, by its real path. It is registered on the app's own session only, so no browser guest can name it, and the host carries a per-launch token the renderer learns over RPC, so a page the agent wrote cannot either.
- **Session and agent machines** (`packages/workspace/src/machines/`) drive an agent turn within a chat or task (a chat runs agent `instrument`, a task agent `main`); the workspace machine supervises them per record.
- **Sandboxing** of what the agent's tools can touch is a userland concern implemented inside each tool, not OS isolation. See [agent-sandbox.md](agent-sandbox.md).

## On-disk layout

Rooted at the workspace folder ([`get-workspace-folder`](../../apps/studio/src/electron-main/lib/get-workspace-folder.ts)):

- `chats/<id>/` — one folder per chat, and the tasks it started inside it under `chats/<id>/tasks/<id>/`, so a chat and its work are one folder. Where a record's folder is says what it is, and which chat a task belongs to; nothing on the record does. `record-folders.ts` indexes where each one is: `resolveRecord(id)` answers a `RecordRef` (`{ kind: "chat", id }` or `{ kind: "task", id, chatId }`) or `NotFound`, and `recordDir` throws for an id no record has rather than guessing a folder. A chat's id is a `ChatId` and its folder a `ChatDir`, brands refining `TaskId` and `TaskDir`, so code that acts for a chat cannot be handed a plain task id. The chat id is how the routes, the window and the agent name a chat; its session is internal to its store, read through `chats.session`, and an address written before (`/chats/ses_…`, in an older reply or a memory) is opened at its chat through `chats.ofSession`. The bash worker never reads the index; each command's exec message carries the record main resolved.
- `tasks/<id>/` — a task a 1.x build made, read only by the layout migration, which moves it into a chat of its own; the app never makes one.
- Every chat and task folder holds `.instrument/{task.db, settings.json}` (per-task SQLite plus one JSON record: what the app knows about the task at the top level, where the user left off under `state`). Every JSON record the workspace keeps (these and a topic's settings) is written through [`json-record-file.ts`](../../packages/workspace/src/lib/json-record-file.ts): atomic, queued per path, unknown fields carried forward, and a file it cannot read refused rather than overwritten. Rows written into a `task.db` outside the store go through `store-table.ts` with `StorageKey`. Legacy layouts are normalized on boot by `migrateWorkspaceLayout` ([`migrate-workspace-layout.ts`](../../packages/workspace/src/lib/migrate-workspace-layout.ts)), which also turns 1.x tasks into chats and 1.x `projects/` into topics, keeping what it moves aside under `.pre-chats/`.
- `topics/<Name>/`: one folder per topic, holding `.instrument/settings.json` and `instructions.md`.
- `apps/<slug>/`: one folder per app, holding `app.json` and its `guide.md`, mounted writable at `/apps` for the chat's agent only.
- `memory/` — what the conversation's agent remembers about the user, one Markdown file per memory, written through its `memory` command and read back into every chat ([memory plan](../plans/active/memory.md)). Readable and editable in a file manager; Settings lists them.
- `skills/` — user-authored and imported skills, mounted writable into the agent at `/skills/workspace/`, beside a read-only mount per other skill source. Skills discovered elsewhere on the machine (co-installed agent homes like `~/.claude` and its peers, enumerated by `getSkillSources` in `packages/workspace/src/lib/skills.ts`) stay where they are.
- The bundled skills registry is **not** here: `registryDir` points at the `registry/` git submodule in development and at the app's `resources/` when packaged, read-only either way, with the bundled system skills (`systemSkillsDir`) beside it.
- `.instrument/` at the root holds the workspace's own electron-stores (`settings/`), the app window's Chromium profile (`app-session/`), and `window/`, the folder the window's own browser tabs and file views are scoped to under the id `window` (`WINDOW_ID`), whose `.instrument/task.db` keeps those tabs' pages.
- Model cache, `uv` data, the prepared skills, and the search indexes live under Electron's `userData`, not the workspace folder.

## An agent turn, end to end

1. The renderer sends a message via oRPC to the main process, into the chat's record.
2. The workspace/session machine runs the chat's agent, which selects tools per agent ([`create-agent.ts`](../../packages/workspace/src/agents/create-agent.ts)). Its work is `task new`/`task send`, each starting or steering a child task under `chats/<id>/tasks/<id>/`, whose own session runs agent `main` with tools executed against that task folder. When a child finishes, the chat wake ([`chat/wake.ts`](../../packages/workspace/src/lib/chat/wake.ts)) runs the chat again to report back.
3. Model calls go through the ai-gateway app (credentials injected there, never in the renderer): the user's own provider keys, plus a first-party provider config synthesized from their auth token when they are signed in, plus one per ChatGPT account signed in with its plan ([`get-ai-provider-configs.ts`](../../apps/studio/src/electron-main/lib/get-ai-provider-configs.ts)). Model metadata/selection uses the ai-gateway library.
4. Results are persisted as message parts in the task's `task.db` and streamed back to the renderer over RPC.
5. Stopping walks the same chain in reverse: session → agent → the in-flight `executeToolCallMachine`, which writes its own "stopped by you" part before the agent finishes. Cancellation is owned by whichever machine holds the work, because leaving a state that invokes a child hard-stops that child before it can react. In `Finishing`, after `onFinish` has persisted what the turn produced, the agent sweeps any of the run's tool parts still in `input-*` (queued siblings, inputs an aborted stream saved, pending interactive calls) to `output-error`, so no call is left dangling in the record. A turn that ends with both queues drained and no stop skips the sweep, since nothing of it can be dangling. A process that dies mid-call reaches none of this, so the other sweep runs where a task's `task.db` is opened (`session-store-storage.ts` → `interrupted-tool-calls.ts`), before anything reads through it: every `input-*` tool part in a session's newest assistant message belongs to a process that is gone, and is written to `output-error` as interrupted.

## Deeper references

- [ai-gateway.md](ai-gateway.md) — model proxy and model library.
- [agent-sandbox.md](agent-sandbox.md) — how tool access is contained.
- [in-app-browser.md](in-app-browser.md) — the one browser in the app, which the user drives and a chat's tasks can drive too.
- [`packages/workspace/AGENTS.md`](../../packages/workspace/AGENTS.md) — RPC, tools, agents, machines, server.
- [`apps/studio/AGENTS.md`](../../apps/studio/AGENTS.md) — renderer, windows, RPC surface, where things live.
