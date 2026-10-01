# Plan: switchable workspaces

Status: not started.

## Why

Testing Studio across sign-in scenarios (an Instrument account, a second account, a ChatGPT plan, BYOK only) means swapping the whole application-data directory today, which also throws away machine state that has nothing to do with the scenario: window bounds, caches, the toolchain in `bin/` and `uv/`. A workspace should be the unit that differs: its chats and tasks, and the sign-ins, keys, flags, and preferences that go with them.

Today the workspace folder is fixed at `<userData>/workspace` (`apps/studio/src/electron-main/lib/get-workspace-folder.ts`), and every setting lives beside it at the root of userData through electron-store, which resolves its directory from `app.getPath("userData")` when each store is constructed.

## Shape

- A workspace is a folder: content at the top level (`chats/`, `tasks/`, `topics/`, `apps/`, `memory/`, `skills/`), app-private state under `.instrument/`, where `workspace.db` already lives. `.instrument/` is the place for anything further a workspace needs to keep.
- `.instrument/workspace.json` holds the workspace's name, color, and who created it (`person` or `agent`, with the agent's purpose), so a copied workspace keeps its identity.
- `.instrument/settings/` holds the per-workspace stores.
- `<userData>/workspaces.json` (machine-level) lists known workspaces by path and records which is active.
- The default workspace is the existing `<userData>/workspace`, named Default. Its chats never move. New workspaces are created under `<userData>/workspaces/<slug>/`.
- One workspace per process. Switching restarts the app.
- `INSTRUMENT_WORKSPACE=<id or absolute path>` pins a process to a workspace for its lifetime without touching `active`. This is how a second, concurrent process (an agent's driven instance) runs a workspace other than the one the person has open.
- Visible only with the `developerMode` preference on, from the dev panel. Developer mode is on in a hot-reloading dev build and can be on in a packaged one, so both have to work.

### Two levels of isolation

| | Workspace (this plan) | Application-data override (`ELECTRON_USER_DATA_DIR`, kept) |
| --- | --- | --- |
| Isolates | Chats, tasks, sign-ins, keys, flags, workspace preferences, renderer `studio.*` storage | Everything under userData: also `bin/`, `uv/`, caches, window bounds, telemetry id, Chromium's profile |
| Shares | Machine stores, toolchain, caches, Chromium profile | Nothing under userData |
| Good for | Scenario testing; an agent's clean room that still boots in seconds on a set-up toolchain | First-install behavior; the packaged smoke test; committed fixtures |
| Concurrent with the person's instance | Yes, as a second process with `INSTRUMENT_WORKSPACE` | Yes, as today |

Neither isolates what Studio reads from the home directory: user-level skill folders (`getSkillSources` in `packages/workspace/src/lib/skills.ts`), memory import sources (`listMemorySources` in `memory/sources.ts`), the home folder every chat can reach (`folder-reach.ts`), `~/Documents/Instrument`, and `~/Downloads`. Only a sandboxed `$HOME`, as the eval harness uses, covers those.

## What is per workspace and what is per machine

| Store / state | Scope | Note |
| --- | --- | --- |
| `session` (`session.json.enc`, `session-dev.json` in dev) | workspace | Instrument account bearer token and Google tokens; sign-in does not live in cookies |
| `providers` | workspace | BYOK keys |
| `chatgpt-plan` (`lib/chatgpt-plan.ts`) | workspace | |
| `app-oauth`, `app-credentials`, `app-connections` | workspace | |
| `features` | workspace | Flags are part of a scenario |
| `preferences` | split | Workspace: `defaultModelURI`, `preferApiKeyOverAccount`, `agentCompletionNotifications`. Machine: `theme`, `developerMode`, `enableUsageMetrics`, `lastLaunchedVersion`, `lastUpdateCheck`, `releaseChannel` |
| `app-state` | split | Workspace: `hasCompletedProviderSetup`, so a new workspace runs onboarding. Machine: `telemetryId`, `lastMigratedVersion` |
| Renderer `localStorage` `studio.*` keys | workspace | Tabs, recents, drafts, compose, bookmarks, and the rest point at this workspace's chats and files |
| `window-state`, `model-cache`, `file-open-targets.json`, icon and thumbnail caches, `bin/`, `uv/`, prepared `skills/`, logs, crash and update logs, Chromium's own directories | machine | |
| `~/Documents/Instrument` (`packages/workspace/src/lib/orchestrator/output-folder.ts`) | machine, for now | Shared across workspaces; see Out of scope |

The developer-mode gate lives in the machine half on purpose: a switcher whose visibility came from the active workspace could hide itself. `register-telemetry.ts` subscribes to `enableUsageMetrics` changes, so that subscription moves with the key to the machine store.

## Steps

### 1. Stores open at an explicit directory

electron-store takes an absolute `cwd` (`index.js:60` in 10.1), so the stores keep the library and gain a directory argument rather than a replacement.

- Add a `workspaceSettingsDir()` beside `getWorkspaceFolder()` returning `<active workspace>/.instrument/settings`.
- Each workspace-scoped store passes `cwd: workspaceSettingsDir()`. Machine stores pass nothing and keep their current files.
- Split `preferences` and `app-state` into a machine store (keeping the root file name) and a workspace store (same file name, under `settings/`). Each schema lists only its own keys; `z.object` strips the others on read, so after migration both halves can start from the same copied file.
- Every caller of a split key moves to the store that owns it.

### 2. Workspace registry, read at boot

- `apps/studio/src/electron-main/lib/workspaces.ts`: Zod schema for `workspaces.json` (`active`, `workspaces: [{ id, path, lastOpenedAt }]`), sync read, atomic write, and `getWorkspaceFolder()` returning the resolved workspace instead of the fixed one.
- Resolution order: `INSTRUMENT_WORKSPACE`, then `active`, then Default.
- Read in `setup-environment.ts` right after the userData directory is settled, before anything opens a store.
- A missing or unreadable registry resolves to Default, so a bad file cannot strand the app. A registered workspace whose folder is gone falls back to Default and logs it.
- Two processes can share one userData, so every registry write re-reads the file and changes only its own entry. A pinned process updates its own `lastOpenedAt` and never writes `active`.

### 3. Migration into Default

Runs synchronously in `setup-environment.ts` after the registry read and before any store is constructed. This is the one step every existing install takes, and seeded fixture directories take it too.

- No registry: write one with Default only.
- For each workspace-scoped store, rename its root file into `<userData>/workspace/.instrument/settings/` unless the target exists. Cover both name sets: dev's plaintext `.json` (with `session-dev.json`) and packaged `.json.enc`. Rename keeps the safeStorage ciphertext as is.
- Copy `preferences.json` and `app-state.json` into `settings/` unless the target exists. The root copies stay as the machine halves, and each half drops the other's keys on its first write.
- Each step skips once its target exists, so a crash mid-migration completes on the next boot.

### 4. Renderer storage scoped by workspace

- Expose the resolved workspace id to the renderer synchronously from the preload, the way the resolved theme is served at boot, because the stored atoms read their values as their modules load.
- Default keeps today's `studio.*` keys unchanged, so existing tabs and drafts need no renderer migration.
- Every other workspace reads and writes `studio.<workspaceId>.*`. Do it in one storage wrapper that every `studio.*` atom already goes through or is moved onto, not per atom. `migrate-window-storage.ts` runs as before and only touches the unscoped keys.
- Unverified: whether a second Electron process on the same userData gets a working `localStorage` at all, since Chromium holds its storage database for the first. Check before the agent path in step 8 relies on it; a clean room can live without persisted tabs.

### 5. Switching restarts the app

- RPC `workspaces.switch({ id })` in the main-process debug routes, gated like the other dev-panel routes. It refuses in a pinned process, since the pin would win on restart anyway.
- Switch runs `requestQuitApproval()` first, so running agents are asked about exactly as when closing the window, then writes `active` and restarts.
- Packaged builds restart with `app.relaunch(); app.exit(0)`.
- Dev builds cannot. electron-vite's dev command spawns Electron and calls `process.exit` when it closes (`ps.on('close', process.exit)`), which also takes down the renderer dev server, so a relaunched child would load a dead URL. Instead main exits with a dedicated code (e.g. 75) and `apps/studio/scripts/dev-supervisor.mjs` runs electron-vite, starts it again on that code, and passes every other exit through. The supervisor keeps the environment and arguments, so `ELECTRON_DEV_USER_FOLDER_SUFFIX`, `REMOTE_DEBUGGING_PORT`, and `DISABLE_DEV_RELAUNCH` still apply.
- The supervisor is what both the `dev` script and `studio-drive.mjs boot` spawn. studio-drive spawns the electron-vite shim directly today to save the cost of `pnpm run` and `cross-env`; it spawns the supervisor the same way instead. Its pid stays the same across a switch, so studio-drive's liveness check and instance record keep working, and the CDP port comes back on the same number.
- A dev switch costs a full electron-vite start (renderer server plus main and preload builds). Measure it once this exists; it has not been timed.

### 6. Managing workspaces

All in the dev panel and backed by debug RPC routes.

- **List**: every registered workspace with color dot, name, size on disk, last opened, and an agent badge with its purpose when an agent made it. The resolved one is marked, and a pinned process says so.
- **Create**: name, color from a fixed palette, and a starting point: blank (runs onboarding) or copy sign-ins from the current workspace (copies the credential stores and `hasCompletedProviderSetup`, nothing else). Copying works as is in dev, where the stores are plaintext; in a packaged build the ciphertext uses the same safeStorage key, so a byte copy works there too. Create does not switch.
- **Delete**: moves the folder to the system Trash with `shell.trashItem` and drops its registry entry. Refused for Default and for the resolved workspace, which have to be switched away from first. Also refused while another process has it pinned, which needs a lock file or pid in `.instrument/` written at boot and removed on quit; a stale pid counts as unlocked.
- **Strays**: folders under `<userData>/workspaces/` with a `workspace.json` but no registry entry are listed as unregistered, with Delete and Re-add, so a damaged registry cannot hide anything on disk.
- **Reaping**: agent-created workspaces not opened for 14 days are trashed on the next boot of any instance, matching how studio-drive already reaps its fixture caches (`WORKSPACE_MAX_AGE_MS`). Person-created workspaces are never reaped.

### 7. Window identity

When the resolved workspace is not Default, the window bar shows its name and a thin stripe in its color, so a screenshot or a driven instance's capture shows which scenario it came from.

### 8. Agents get a clean room through studio-drive

- `studio-drive.mjs boot --clean-room <name>` creates (or reuses) an agent workspace under the shared dev userData and boots a second process with `INSTRUMENT_WORKSPACE` pointing at it, on a port keyed like `--workspace` already keys fixture runs. `--with-sign-ins` copies sign-ins from Default so the clean room can run a real agent turn; without it the instance boots with `SKIP_ONBOARDING=true` as fixture runs do.
- The agent never switches the person's instance. It runs its own process, and the switch route refuses in a pinned process, so a mistaken call cannot move anything.
- `--workspace <fixture>` stays on `ELECTRON_USER_DATA_DIR`. Committed fixtures want nothing shared with the developer's machine, and the Windows host (`seeded-workspaces-on-windows.md`) and the packaged smoke test depend on that path. Folding fixtures into workspaces is a later choice, not part of this plan.
- Update the `studio-chrome-devtools` skill: when to use a clean room, when a fixture, and when a full application-data override.

### 9. Retire the new-user-folder mode

What it gives: a fresh `Instrument (<timestamp>)` userData via `ELECTRON_USE_NEW_USER_FOLDER`, the `dev:fresh` script, and the dev panel's `debug.relaunchWithNewUserFolder`, with usage metrics defaulting off for that folder. In use, that is scenario testing, which a blank workspace now covers without leaving a whole application-data directory behind each time.

- Delete `ELECTRON_USE_NEW_USER_FOLDER` and its branch in `setup-environment.ts`, `dev:fresh`, `relaunchWithNewUserFolder` and its dev panel button and dialog, `getDefaultEnableUsageMetrics()`, and the env entries in `vite-env.d.ts`.
- First-install testing in dev, the one thing it did that a workspace does not (fresh `bin/` and `uv/` setup, empty caches, first-launch window placement, a fresh Chromium profile and telemetry id), is `ELECTRON_USER_DATA_DIR=<empty dir> pnpm dev`. Say so in `.agents/env.md`.
- Scenario sessions now report usage under the machine's `enableUsageMetrics` and telemetry id, where the fresh folder used to default metrics off. Turn metrics off in Settings on a development machine if scenario sessions should not count.
- Update `privacy-first-diagnostics-and-feedback.md`, which cites the new-user-folder default.

## Tests

- Registry: missing, unreadable, and dangling-path files resolve to Default; `INSTRUMENT_WORKSPACE` wins over `active`; a pinned process never writes `active`; two writers each keep the other's entry.
- Migration over a temp userData for both name sets (dev and packaged): files land under `settings/`, a second run is a no-op, an existing target is never overwritten, each half of a split store reads only its own keys.
- Store construction: a workspace store opened with a temp `cwd` reads and writes there and nowhere else.
- Renderer storage wrapper: Default passes keys through unchanged; another workspace prefixes them.
- Supervisor: restarts on the relaunch code with the same environment and arguments, exits with the child's code otherwise.
- Management: copy sign-ins copies only the credential stores; delete refuses Default, the resolved workspace, and a pinned one; strays are listed; only agent workspaces are reaped.
- By hand in dev: create a workspace with sign-ins copied, switch, sign in to a different account, switch back, and confirm Default's tabs, sign-in, and model are where they were. Then `boot --clean-room` beside it and confirm the person's instance is untouched.

## Out of scope

- Two workspaces open at once as separate windows of one process. Needs two workspace actors in one process. Keeping the workspace id explicit in the registry and in renderer storage keys leaves that open; step 8 already gets two workspaces running at once as two processes.
- A per-workspace output folder in place of the shared `~/Documents/Instrument`. The cost of sharing it is files from one scenario showing up in another's listings, not broken state.
- Replacing electron-store. With `cwd` it no longer causes the path problem. The `conf@14.0.0` patch stays needed: conf 15.1.0, which electron-store 11 depends on, still declares the loose `set(key: string, value: unknown)` overload the patch removes (see `dependency-work-behind-the-pr-queue.md`). If the store is replaced later, the hard part to borrow rather than write is the atomic write (`write-file-atomic` and `atomically` are both already in the dependency tree); the parsing and encryption every store needs are already ours.
- Closing the window when the last tab closes. `closeTab` in `apps/studio/src/client/lib/tabs-model.ts` seeds a fresh tab today; changing that is independent of this plan.
