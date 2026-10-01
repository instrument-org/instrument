# Plan: switchable workspaces

Status: implemented; awaiting review before it lands.

## Why

Testing Studio across sign-in scenarios (an Instrument account, a second account, a ChatGPT plan, BYOK only) means swapping the whole application-data directory today, which also throws away machine state that has nothing to do with the scenario: caches, the toolchain in `bin/` and `uv/`. A workspace should be the unit that differs: its chats and tasks, the sign-ins, keys, flags, and preferences that go with them, the websites it is signed into, and how its window was left.

Today the workspace folder is fixed at `<userData>/workspace` (`apps/studio/src/electron-main/lib/get-workspace-folder.ts`), and every setting lives beside it at the root of userData through electron-store, which resolves its directory from `app.getPath("userData")` when each store is constructed.

This is a developer-mode affordance. How workspaces are presented to people, if they ever are, is a later product decision; nothing here is designed to be that.

## Decisions

- **Settings live in `.instrument/` at the workspace root**, beside `workspace.db`, which leaves room for whatever else a workspace comes to keep.
- **Switching restarts the app.** Every store is a lazy module singleton and the workspace actor, bash worker, skill watcher, browser view manager, and RPC handlers are all built once at boot; tearing each down and rebuilding it is more work than a restart costs.
- **Keep electron-store, opened at an explicit directory.** It takes an absolute `cwd` (`index.js:60` in 10.1), which removes the path problem without touching the ten stores that have worked for a long time. Its API stays what it is: dot-path keys, a loose `set(key: string, value: unknown)` overload we patch out (`patches/conf@14.0.0.patch`; conf 15.1.0, which electron-store 11 depends on, still declares it), and construction that reads app paths. This plan contains that by giving every store a lazy getter named for its scope. Replacing the library is a separate plan if it is ever wanted; the hard part to borrow then is the atomic write (`write-file-atomic` and `atomically` are already in the dependency tree), since the Zod parsing and safeStorage encryption are already ours.
- **The app window's Chromium profile is per workspace**, not only the in-app browser's. See step 4.
- **The workspace selector is in the dev panel only**, visible when the resolved workspace has developer mode on.

## Shape

- A workspace is a folder: content at the top level (`chats/`, `tasks/`, `topics/`, `apps/`, `memory/`, `skills/`), app-private state under `.instrument/`.
- `.instrument/workspace.json`: name, color, who created it (`person` or `agent`, with the agent's purpose), and `settingsVersion` for the per-workspace migrations in step 3.
- `.instrument/settings/`: the workspace's stores.
- `.instrument/app-session/`: the app window's Chromium profile (step 4).
- `.instrument/browser-session/`: the in-app browser's Chromium profile, already here today.
- `<userData>/workspaces.json` (machine-level) lists known workspaces by path and records which is active.
- The default workspace is the existing `<userData>/workspace`, named Default. Its chats never move. New workspaces are created under `<userData>/workspaces/<slug>/`.
- One workspace per process. Switching restarts the app.
- `INSTRUMENT_WORKSPACE=<id or absolute path>` pins a process to a workspace for its lifetime without touching `active`. This is how a second, concurrent process (an agent's driven instance) runs a workspace other than the one the person has open.
- Developer mode is on in a hot-reloading dev build and can be on in a packaged one, so both have to work.

### Two levels of isolation

| | Workspace (this plan) | Application-data override (`ELECTRON_USER_DATA_DIR`, kept) |
| --- | --- | --- |
| Isolates | Chats, tasks, sign-ins, keys, flags, preferences, window bounds, the app window's and the in-app browser's Chromium profiles (cookies, cache, history, bookmarks, tabs) | Everything under userData: also `bin/`, `uv/`, caches, telemetry id |
| Shares | Machine stores, toolchain, caches | Nothing under userData |
| Good for | Scenario testing; an agent's clean room that boots in seconds on an already set-up toolchain | First-install behavior; the packaged smoke test; committed fixtures |
| Concurrent with the person's instance | Yes, as a second process with `INSTRUMENT_WORKSPACE` | Yes, as today |

Neither isolates what Studio reads from the home directory (user-level skill folders, memory import sources, the home folder every chat can reach), `~/Documents/Instrument`, or `~/Downloads`. That is intended.

## Stores: what is per workspace and what is per machine

Store modules move into `apps/studio/src/electron-main/stores/workspace/` and `stores/machine/`, and every getter is named for its scope (`getWorkspacePreferences()`, `getMachineState()`), so which half a key lives in is visible at the call site. Within each half, *preferences* are what a person chose and *state* is what the app remembers.

### Per workspace, in `.instrument/settings/`

| File | Holds | Comes from |
| --- | --- | --- |
| `preferences.json` | `theme`, `developerMode`, `defaultModelURI`, `agentCompletionNotifications` | root `preferences.json` |
| `state.json` | `hasCompletedProviderSetup` (a new workspace runs onboarding) | root `app-state.json` |
| `window-state.json` | Window bounds and maximized flag by window, zoom | root `window-state.json`, moved as is |
| `session` (`.json.enc`; `session-dev.json` in dev) | Instrument account bearer token and Google tokens | root file, unchanged |
| `providers` | BYOK keys | root file, unchanged |
| `chatgpt-plan` | ChatGPT sign-in | root file, unchanged |
| `app-oauth`, `app-credentials`, `app-connections` | Connected apps and their tokens | root files, unchanged |
| `features.json` | Feature flags | root file, unchanged |

Plus outside `settings/`: `page-thumbnails/` (pictures of pages viewed in the in-app browser, so they carry what a signed-in page showed), moved from `<userData>/page-thumbnails`.

`developerMode` defaults to on for any workspace the switcher creates, and to the build's default for Default (`import.meta.env.DEV`, as today). Turning it off in another workspace hides the selector until it is turned back on in Settings, which is acceptable for the people using this.

`preferApiKeyOverAccount` is dropped rather than moved: it is stored and served over RPC (`rpc/routes/preferences.ts`) but nothing reads it.

### Per machine, at the userData root

| File | Holds |
| --- | --- |
| `machine-preferences.json` | `enableUsageMetrics`, `releaseChannel` |
| `machine-state.json` | `telemetryId`, `lastMigratedVersion`, `lastLaunchedVersion`, `lastUpdateCheck` |
| `workspaces.json` | The registry |
| `model-cache.json`, `file-open-targets.json`, `site-icons/`, `file-open-icons/`, `file-thumbnails/` | Caches of the computer, keyed by provider, app, origin, or file path |
| `bin/`, `uv/`, prepared `skills/`, logs, crash and update logs, `app.lock` | Toolchain and diagnostics |

The `machine-` prefix on the root files keeps them distinct from the legacy `preferences.json` and `app-state.json`, which step 3 reads and then removes. `register-telemetry.ts` subscribes to `enableUsageMetrics` changes; that subscription moves with the key.

## Steps

### 1. Stores open at an explicit directory

- `workspaceSettingsDir()` beside `getWorkspaceFolder()` returns `<resolved workspace>/.instrument/settings`.
- Each workspace store passes `cwd: workspaceSettingsDir()`. Machine stores keep the default directory.
- `window-state.ts` builds its store at module scope today. It gets a lazy getter like the others and moves to the workspace's settings folder as its own file rather than a key of `state`: a moved or resized window writes on every settle, and nothing should be notified of that but the next launch. The per-display work-area learning stays in memory as it is.
- Split preferences and app state into the four stores above and move every caller of a key to the store that owns it.

### 2. Workspace registry, read at boot

- `apps/studio/src/electron-main/lib/workspaces.ts`: Zod schema for `workspaces.json` (`active`, `workspaces: [{ id, path, lastOpenedAt }]`), sync read, atomic write, and `getWorkspaceFolder()` returning the resolved workspace instead of the fixed one.
- Resolution order: `INSTRUMENT_WORKSPACE`, then `active`, then Default.
- Read in `setup-environment.ts` right after the userData directory is settled, before anything opens a store.
- A missing or unreadable registry resolves to Default, so a bad file cannot strand the app. A registered workspace whose folder is gone falls back to Default and logs it.
- Two processes can share one userData (several worktrees already do), so every registry write re-reads the file and changes only its own entry. A pinned process updates its own `lastOpenedAt` and never writes `active`.

### 3. Migrations: machine once, a workspace only when it is opened

Nothing outside the resolved workspace is migrated. A workspace that is never opened is never touched; when one is opened by a later build, it takes the same path then. This is the model `migrateWorkspaceLayout` (`.instrument/.layout-version`) already follows for task folders, and the settings migration sits beside it.

Order at boot, all synchronous in `setup-environment.ts`, before any store is constructed:

1. **Resolve** the workspace (step 2).
2. **Machine migration**, once per machine: if `machine-preferences.json` or `machine-state.json` is missing, build it from the machine keys of the legacy root `preferences.json` and `app-state.json`. Read-only on the legacy files.
3. **Workspace migration** for the resolved workspace only, driven by `settingsVersion` in its `workspace.json`:
   - Version 1 for Default: rename the legacy credential and feature files from the root into `settings/` (both name sets: dev's plaintext `.json` with `session-dev.json`, packaged `.json.enc`; rename keeps the safeStorage ciphertext as is); move `window-state.json` as is; build `preferences.json` and `state.json` from the legacy root `preferences.json` and `app-state.json`; move `page-thumbnails/`; copy the default session's `Local Storage/` into `.instrument/app-session/` (step 4). Then remove the legacy root `preferences.json` and `app-state.json`, whose machine keys step 2 already took.
   - Version 1 for any other workspace: nothing legacy to consume; stamp the version.
   - Each sub-step skips once its target exists, so a crash mid-migration completes on the next boot.
4. **Open stores.**

The first boot after upgrade always resolves Default, since no registry exists yet to name anything else; a pinned fixture or agent process that boots first simply leaves the legacy files for Default's first boot.

### 4. The app window's Chromium profile per workspace

The in-app browser is already per workspace: every guest runs on one session at `<workspace root>/.instrument/browser-session` (`getBrowserSessionDir` in `packages/workspace/src/lib/task-dir-utils.ts`), so cookies, cache, IndexedDB, and service workers follow the workspace once its root changes. Two workspaces signed into two Gmail accounts already works.

What does not follow is the app window itself, which runs on Electron's default session in userData. Its `localStorage` holds every `studio.*` key: tabs, recents, drafts, compose, bookmarks, visited pages (the browser history), and the rest, all of which point at one workspace's chats and pages.

- Open the app and onboarding windows on `session.fromPath(<workspace>/.instrument/app-session)`.
- Move what `index.ts` applies to `session.defaultSession` today (the standard user agent, the permission handler, the platform authenticator) and the `app:` protocol handler (`lib/app-protocol.ts` registers it through the global `protocol`, which is the default session's) into one `configureAppSession(session)` that the workspace session gets. Scheme privileges stay global in `registerSchemesAsPrivileged`.
- `net.fetch` for site icons stays on the default session; those are machine caches.
- Default's existing storage comes across in step 3's copy of `Local Storage/`, so no `studio.*` key changes name and `migrate-window-storage.ts` runs unchanged.
- Two processes on the same workspace (several worktrees on Default, as today) share one profile directory, exactly as two processes share the default session today. No worse than now; not solved here.

### 5. Switching restarts the app

- RPC `workspaces.switch({ id })` in the main-process debug routes, gated like the other dev-panel routes. It refuses in a pinned process, since the pin would win on restart anyway.
- Switch runs `requestQuitApproval()` first, so running agents are asked about exactly as when closing the window, then writes `active` and restarts.
- Packaged builds restart with `app.relaunch(); app.exit(0)`.
- Dev builds cannot. electron-vite's dev command spawns Electron and calls `process.exit` when it closes (`ps.on('close', process.exit)`), which also takes down the renderer dev server, so a relaunched child would load a dead URL. Instead main exits with a dedicated code (e.g. 75) and `apps/studio/scripts/dev-supervisor.mjs` runs electron-vite, starts it again on that code, and passes every other exit through. It keeps the environment and arguments, so `ELECTRON_DEV_USER_FOLDER_SUFFIX`, `REMOTE_DEBUGGING_PORT`, and `DISABLE_DEV_RELAUNCH` still apply.
- The supervisor is what both the `dev` script and `studio-drive.mjs boot` spawn. studio-drive spawns the electron-vite shim directly today to save the cost of `pnpm run` and `cross-env`; it spawns the supervisor the same way instead. Its pid stays the same across a switch, so studio-drive's liveness check and instance record keep working, and the CDP port comes back on the same number.
- A dev switch costs a full electron-vite start (renderer server plus main and preload builds): on an M1 Max, the new workspace's main process was up about 3 seconds after the old one exited, and the window was drivable after about 14.

### 6. Managing workspaces

All in the dev panel, backed by debug RPC routes. Plain rows, nothing designed: this is a tool for us.

- **List**: every registered workspace with color dot, name, size on disk, last opened, and an agent badge with its purpose when an agent made it. The resolved one is marked, and a pinned process says so.
- **Create**: name, color from a fixed palette, and a starting point: blank (runs onboarding) or copy sign-ins from the current workspace (the session, providers, and ChatGPT plan stores plus `hasCompletedProviderSetup`; connected apps stay, since their tokens belong to apps in the workspace they came from). Developer mode is mirrored from the workspace doing the creating, so one made from the dev panel can reach the dev panel and one made any other way later does not inherit it by accident. In dev the stores are plaintext; in a packaged build the ciphertext uses the same safeStorage key, so a byte copy works there too. Create does not switch.
- **Delete**: moves the folder to the system Trash with `shell.trashItem` and drops its registry entry. Default has no Delete control at all. The resolved workspace's is disabled until you switch away. A workspace another process has open is refused; each process writes its pid to `.instrument/open.pid` at boot and removes it on quit, and a pid that is no longer running counts as closed. The pid file is advisory only and does not stop two processes opening the same workspace.
- **Strays**: folders under `<userData>/workspaces/` with a `workspace.json` but no registry entry are listed as unregistered, with Delete and Re-add, so a damaged registry cannot hide anything on disk.
- **Dangling entries**: a registered workspace whose folder is gone is dropped from the registry as the list is read, whoever removed the folder (Finder, or studio-drive reaping a clean room in step 8). The app itself never deletes a workspace folder on its own.

### 7. Window identity

When the resolved workspace is not Default, the dev panel's badge in the window bar shows its color dot and name beside the instance label, so a screenshot or a driven instance's capture shows which scenario it came from. Deliberately the dev panel and nothing more: how workspaces would be shown to people is a product decision for later.

### 8. Agents get a clean room through studio-drive

- `studio-drive.mjs boot --clean-room <name>` creates (or reuses) a workspace folder under studio-drive's own cache root (`~/Library/Caches/instrument-studio-drive/<checkout>/clean-rooms/<name>` on macOS, beside its fixture caches), and boots a second process on the shared dev userData with `INSTRUMENT_WORKSPACE` set to that absolute path, on a port keyed the way `--workspace` already keys fixture runs. The app registers it as agent-created on first open, so it shows in the dev panel.
- `--with-sign-ins` copies sign-ins from Default so the clean room can run a real agent turn, which fixture runs cannot. Without it the instance boots with `SKIP_ONBOARDING=true`, as fixture runs do.
- studio-drive reaps clean rooms it has not booted in 14 days with the same rule it applies to fixture caches (`reapStaleWorkspaces`, `WORKSPACE_MAX_AGE_MS`), which only ever deletes inside its own cache root. Agent work therefore never sits in, or is deleted from, the shared application-data directory.
- The agent never switches the person's instance. It runs its own process, and the switch route refuses in a pinned process, so a mistaken call cannot move anything.
- `--workspace <fixture>` stays on `ELECTRON_USER_DATA_DIR`. Committed fixtures want nothing shared with the developer's machine, and the Windows host (`seeded-workspaces-on-windows.md`) and the packaged smoke test depend on that path.
- Update the `studio-chrome-devtools` skill: when to use a clean room, when a fixture, and when a full application-data override.

### 9. Retire the new-user-folder mode

It gives a fresh `Instrument (<timestamp>)` userData via `ELECTRON_USE_NEW_USER_FOLDER`, the `dev:fresh` script, and the dev panel's `debug.relaunchWithNewUserFolder`, with usage metrics defaulting off there. In use that is scenario testing, which a blank workspace now covers without leaving an application-data directory behind each time.

- Delete `ELECTRON_USE_NEW_USER_FOLDER` and its branch in `setup-environment.ts`, `dev:fresh`, `relaunchWithNewUserFolder` and its dev panel button and dialog, `getDefaultEnableUsageMetrics()`, and the env entries in `vite-env.d.ts`.
- First-install testing in dev, the one thing it did that a workspace does not (fresh `bin/` and `uv/` setup, empty caches, a fresh telemetry id), is `ELECTRON_USER_DATA_DIR=<empty dir> pnpm dev`. Say so in `.agents/env.md`.
- Scenario sessions report usage under the machine's `enableUsageMetrics` and telemetry id, where the fresh folder used to default metrics off. Turn metrics off on a development machine if scenario sessions should not count.
- Update `privacy-first-diagnostics-and-feedback.md`, which cites the new-user-folder default.

## Tests

- Registry: missing, unreadable, and dangling-path files resolve to Default; `INSTRUMENT_WORKSPACE` wins over `active`; a pinned process never writes `active`; two writers each keep the other's entry.
- Migration over a temp userData for both name sets (dev and packaged): the machine files are built from the legacy root files; Default's version 1 lands every file under `settings/` and removes the three legacy root files; a second run is a no-op; an existing target is never overwritten; a non-Default workspace opened first leaves the legacy files alone; a workspace that is not opened is not touched.
- Store construction: a workspace store opened with a temp `cwd` reads and writes there and nowhere else.
- App session: the app window's session path is under the resolved workspace, and `configureAppSession` applies the user agent, permission handler, authenticator, and `app:` handler to it.
- Supervisor: restarts on the relaunch code with the same environment and arguments, exits with the child's code otherwise.
- Management: copy sign-ins copies only the credential stores; Default offers no delete; delete refuses the resolved workspace and one with a live pid; strays are listed; dangling entries are dropped.
- By hand in dev: create a workspace with sign-ins copied, switch, sign in to a different Gmail account in the in-app browser and resize the window, switch back, and confirm Default's tabs, history, sign-ins, model, theme, and window size are where they were. Then `boot --clean-room` beside it and confirm the person's instance is untouched.

## Checked by hand

- Booted on an APFS clone of a real dev application-data directory (12 GB, an Instrument account signed in, months of chats): the migration ran once, the account, default model, theme, and the window's 14 `studio.*` localStorage keys (tabs included) came across, and a second boot migrated nothing.
- Created a workspace with sign-ins copied, switched to it under `pnpm dev`'s supervisor, found it signed in with no chats and its own window size and theme, switched back to the default workspace's chats and tab, and deleted the new one to the Trash. Deleting the default workspace, and one another process held open, were both refused.
- `studio-drive boot --clean-room` beside a running instance on the same application data: signed in, pinned, listed as agent-made in the other instance, and its own switch refused.


- Two workspaces open at once as separate windows of one process. Needs two workspace actors in one process. Step 8 already gets two workspaces running at once as two processes, each with its own window state.
- A per-workspace output folder in place of the shared `~/Documents/Instrument` (`packages/workspace/src/lib/orchestrator/output-folder.ts`).
- Replacing electron-store (see Decisions).
- `<userData>/Partitions/browser-*`, left by an older per-task browser layout. Nothing in the current code opens them.
- Closing the window when the last tab closes. `closeTab` in `apps/studio/src/client/lib/tabs-model.ts` seeds a fresh tab today; changing that is independent of this plan.
