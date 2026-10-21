# Plan: switch, open and move workspaces without restarting

Status: phase 1 (this inventory) written; phase 2 under way. Related: [workspace-layout.md](workspace-layout.md) (the workspace as a folder you pick, and its "two workspaces in one process" note), [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md) (the setup folder step that calls these routes).

`workspaces.switch`, `workspaces.open` and `workspaces.move` (`apps/studio/src/electron-main/rpc/routes/workspaces.ts`) record the choice and restart the app (`relaunchApp`), because the main process opens one workspace at boot and much of it hangs off that workspace for the life of the process. This plan closes what is open for one workspace and opens the next in the same process, so the three routes answer without a restart, and falls back to the restart when anything in the live path fails.

It also moves the code toward a process that could hold more than one workspace: what is open for a workspace is held by one object for that workspace and looked up through it, rather than by a module-level variable per holder.

## What holds "the workspace" today

### Settled before anything opens

| Holder | Where | What it needs on a switch |
|---|---|---|
| The resolved workspace | `resolvedWorkspace`, `lib/workspaces.ts:972`, set by `openWorkspace()` in `setup-environment.ts:127` | Settled again through the same steps for the next one: resolve, `finishPendingMove`, the refusal check, the workspace's settings migration, `moveMachineData`, `cleanUpMachineData`, `settleWorkFolders`, then set. The machine settings migration, `renameMachineFolder` and `settlePlatformApiServer` are the process's and run once |
| The open mark | `markWorkspaceOpen` / `releaseOpenMark`, `setup-environment.ts:221`, `lib/workspaces.ts:994` | Released for the old machine folder, taken for the new one; the exit handler releases whichever is held |
| Every path getter | `lib/get-workspace-folder.ts` (`getWorkspaceFolder`, `workspaceMachineDir`, `workspaceKeysDir`, `workspaceBrowserDir`, `workspaceWindowDir`, `workspaceWorkFoldersDir`, `workspaceInAppData`) | Nothing: they read the resolved workspace on every call |

### Stores opened on first use

Each keeps its `Store` in a module variable and never lets it go. On a switch each must be dropped so its next use opens the new workspace's file.

| Store | Where |
|---|---|
| App connections | `stores/workspace/app-connections.ts:26` |
| App credentials | `stores/workspace/app-credentials.ts:27` |
| App OAuth | `stores/workspace/app-oauth.ts:30` |
| Downloads, and the list read from it | `stores/workspace/downloads.ts:36`, `browser-view/download-list.ts:16` |
| External app links | `stores/workspace/external-app-links.ts:21` |
| Kept state (`layout`, `view`) | `stores/workspace/kept-state.ts:208`: flushed before it goes |
| Workspace preferences | `stores/workspace/preferences.ts:83` |
| Provider configs | `stores/workspace/provider-configs.ts:50` |
| The account sign-in, and its rewrite-on-open flag | `stores/workspace/session.ts:61,65` |
| Workspace state (model routes) | `stores/workspace/state.ts:23` |
| Window state | `stores/workspace/window-state.ts:45` |
| ChatGPT accounts and their refresh actors | `lib/chatgpt-account.ts:107`, `grants` at `:718`: every grant stopped, since a grant left running would refresh into the next workspace's store |
| Grok accounts and their refresh actors | `lib/grok-account.ts:122`, and its `grants` |
| Browser history | `browser-view/history-store.ts:460` |
| Drafts, with its folder watch | `drafts/serve-drafts.ts:11`: the watch stopped, the store dropped |
| Bookmarks, a synced store with its watch | `bookmarks/serve-bookmarks.ts:26`: opened inside `serveBookmarks`, which also registers its IPC and a focus listener. The store becomes per workspace; the IPC and listener stay once per process and reach the store open now |
| The apps folder the app routes know | `lib/apps.ts:34` (`rememberAppsDir`) |
| The refusal rule for the file channel | `lib/refused-files.ts:184`: keyed by the workspace's path, so it misses on its own |
| RPC response cache | `rpc/middleware/cache.ts:46`: keyed by route and input, which a provider id can repeat across workspaces; cleared |
| Platform API queries | `platform-api/client.ts:62`: the sign-in is the workspace's, so the cache is cleared |

### Chromium sessions and the browser

| Holder | Where | What it needs |
|---|---|---|
| The app window's session | `lib/app-session.ts:31` (`browser/app-session` in the machine folder) | A window cannot change session, so the app window is closed and a new one opened on the next workspace's session. The old session stays in memory (Electron cannot drop one) and is unused |
| The in-app browser's session | `browser-view/guest-session.ts:22`, which throws when asked for a second folder | Asked for another folder, it sets that one up. Ad blocking registers its IPC once per process (`browser-view/content-blocking.ts:71-90`) and follows the session open now |
| The browser view manager | `browser-view/manager.ts:112`, made in `create-workspace-actor.ts:205` | `teardown()`, then a new one with the next workspace's actor |
| Page editor's served session | `page-editor/sessions.ts:50` | Follows the guest session it is handed |

### The workspace actor and what boot starts beside it

| Holder | Where | What it needs |
|---|---|---|
| The workspace actor, its server and its port | `create-workspace-actor.ts` (`createActor(workspaceMachine)`), `packages/workspace/src/logic/server/index.ts:103` | `actor.stop()` stops every session and closes the server; the next actor binds its own port and publishes it (`logic/server/url.ts:5`) |
| The config and the actor ref | `packages/workspace/src/lib/workspace-config.ts:10`, `lib/workspace-actor-ref.ts:7`, set by the machine's context (`machines/workspace/index.ts:316`) and `attachChats` | Set again by the next actor |
| Chat records | `lib/records/chat-records.ts:1350`, installed by the machine's context | Disposed (every append landed and synced), then replaced by the next actor's |
| The chat index | `lib/record-folders.ts:39` | Keyed by the chats folder, so it misses on its own; dropped anyway (`forgetChatFolders`) |
| `workspace.db` | `lib/workspace-db.ts:21` | Closed (`closeWorkspaceDb`); reopens on the next config's file |
| Record arrivals | `lib/records/take-arrivals.ts:29`, started in `create-workspace-actor.ts:310` with focus listeners added at every start | `stopRecordArrivals`; the focus listeners move to boot, once, and reach whichever arrivals are running |
| Chat wiring | `lib/chat/attach.ts:24`: seven `publisher.subscribe` loops and the overdue timer, each capturing the actor | `attachChats` answers a detach: an `AbortSignal` ends every loop, the timer is cleared, and the wakes waiting on a debounce are dropped |
| The bash worker | `lib/bash-worker/client.ts:84` | Gets the config with every command, but keeps state built from it; retired, and the next command starts a fresh one |
| Background processes and agent-browser sessions | `killAllBackgroundProcesses`, `closeAllAgentBrowserSessions` | Run as the quit runs them |
| Bundled skills and the base Python | `create-workspace-actor.ts:334-349` | The runtime folder's, shared by every workspace: started at boot only |
| The top-level folders watch | `create-workspace-actor.ts:510`, `stopWatchingFolders` | Already replaced when another opens; stopped with the workspace |
| The quit machine and `before-quit` | `create-workspace-actor.ts:394,464` | Once per process, at boot, reaching the workspace open now through a lookup rather than a captured actor |

### Read through a captured actor or config

| Holder | Where | What it needs |
|---|---|---|
| RPC context | `rpc/initialize.ts`: each port is upgraded with the actor and config captured at boot | Upgraded with the workspace open when the port is made; the new window makes a new port |
| Completion notifications | `lib/agent-completion-notifications.ts:82`, one `session.done` subscription with the actor captured | Takes a getter |
| The quit prompt | `confirmQuitWithRunningWork`, `create-workspace-actor.ts` | Through the lookup |
| Device id | `chooseLaunchDeviceId`, `lib/launch-device-id.ts`: a device of its own when another process holds the workspace | Chosen again for the next workspace, and its `device.json` written |
| Claude account | `lib/claude-account.ts:170` (`accountDir()` in the machine folder) and its last reading | Read again (`refreshClaudeAccountStatus`) |
| Setup facts | `lib/setup-facts.ts:90,163` | Read again (`refreshSetupFacts`, and the plan fact for the sign-in now) |

### The renderer

The renderer is not reset in place. The app window is closed and opened again: a new web contents on the next workspace's session, whose preload reads the kept state, the drafts, the bookmarks and setup's state from main as a first launch does, and whose queries start empty. Every `live.*` subscription and folder watch the old window held ends with its port.

## The switch, in order

1. **Ask.** `requestQuitApproval`, the prompt a restart already asks about running agents and jobs. Declined, nothing changes and the route answers `canceled`. Approved, the approval is withdrawn at the end, so a later quit asks again.
2. **Record the choice**: the registry's active entry for a switch or open (with setup's sign-ins carried for an open from the folder step), `requestWorkspaceMove` for a move. The same `beforeRestart` the restart path runs.
3. **Answer the route** (`switching`), so the window that asked hears back before it goes. The rest runs on the next turn of the event loop.
4. **Quiesce**: the tasks at work stopped and their chats told (`interruptTasksForQuit`), background processes killed, agent-browser sessions closed.
5. **Close the window** without the close counting as the last window's (no quit on Windows and Linux), and tear down the browser views.
6. **Close the workspace**: chat wiring detached, record arrivals stopped, chat records disposed, the actor stopped (its sessions and server with it), `workspace.db` closed, the chat index dropped, the bash worker retired, kept state flushed, then everything the workspace's scope opened closed in the reverse of the order it opened: stores, watches, refresh actors, the history. The open mark released.
7. **Settle the next one** through the boot's own steps. A move runs here, in process (below). A folder the boot would refuse is not opened: the switch falls back.
8. **Open it**: a device id chosen, the actor created with the same inputs boot gives it, chat wiring attached, record arrivals started, bookmarks and drafts opened, the account refreshes scheduled, the Claude account and setup's facts read again.
9. **Open the window.**

Any step from 4 on that throws, and a refusal at 7, falls back: logged, then the app restarts through `relaunchApp`, which finds nothing running to ask about and whose next launch settles the recorded choice as it always has.

## The move in process

`finishPendingMove` (`lib/workspace-move.ts`) is written for a launch with nothing open: it renames `.instrument/` into the target, moves the rest of the old folder's top level, rewrites stored paths, then clears the pending move. In process it runs at step 7, after step 6 has closed every file under the workspace: chat records synced and closed, the drafts and folder watches stopped, the stores dropped. It checks the open mark against other processes only, so this process holding it does not postpone the move. What it cannot do in place (a copy across volumes cut short, an aside it could not delete) it leaves recorded for the next launch, as it does today, and the workspace opens wherever it left it.

## Where the workspace's things live

A `WorkspaceScope` (`lib/workspace-scope.ts`) is what is open for one workspace: each store and watch opened for it, keyed by the getter that opened it, with how it closes. `perWorkspace(open, close)` makes a getter that opens its value once per scope; closing the scope closes them all. The process has one scope open at a time, found through `currentWorkspaceScope()`, so a second window on another workspace later means looking up its scope rather than finding every module variable again.

The running half (`RunningWorkspace`: actor, config, device, browser view manager, and its `close()`) is what `create-workspace-actor.ts` answers, and what the RPC handshake, the quit and the notifications look up.

## Risks, and how each is checked

| Risk | Check |
|---|---|
| A holder missed: something reads the old workspace after the switch (a store, a timer, a grant) | Unit tests per holder that open a scope, use the holder, close it, and see the next use open the new folder; a real boot that switches and reads chats, providers, model and setup in the new workspace; the log scanned for writes under the old folder after the switch |
| A subscription left running doubles a wake or a retitle | Test that `attachChats`' detach ends its loops: a `session.done` after the detach reaches no handler |
| A turn's last writes lost | The switch asks first and stops tasks the way the quit does; chat records are disposed (landed and synced) before the actor stops |
| The window's close quits the app on Windows and Linux | The close during a switch is marked; tested in the window module |
| A move fails part-way in process | `finishPendingMove`'s existing tests, plus one that runs it after a workspace was open and closed in the same process |
| The Chromium session of the old workspace keeps files open (Windows) | Its folder is in the machine folder, which a move does not move; noted for Windows, not checked here |
| A sign-in in flight lands in the next workspace | The account sign-in and app OAuth callbacks write through the store open at the time they finish; the prompt does not count them. Left as a known gap |
| A failure leaves the process half closed | Every failure from step 4 on restarts the app |

## Not in this plan

- Two workspace windows at once. The scope and the running workspace are looked up, so it is a lookup per window away, but the window, the RPC context and the browser are still one per process.
- Keeping the old window on screen while the next workspace opens. The window closes and a new one opens, as a restart's would, without the process going.
