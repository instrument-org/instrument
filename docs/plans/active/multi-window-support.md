# Plan: multiple top-level app windows

Status: not started, under consideration. Investigation complete; gated behind a `multi_window` feature flag if we build it. Owner: TBD.

---

## Goal

Let the user open more than one full app window at once (each its own tab strip, chrome, and view state), rather than the single main window we ship today. Ship it behind a feature flag, opened via a native `Cmd+N` ("New Window") hotkey.

## TL;DR verdict

Feasible, and more than half of it already exists. The **main-process backend is already multi-client**: the onboarding window is a second `BrowserWindow` that talks to the same backend (workspace actor, RPC handler, servers) concurrently today, so none of that infrastructure needs to change. What breaks is a handful of _single-main-window assumptions_ in the main process plus one structural issue in the renderer (tab state shares a single `localStorage` origin). A working flagged version is roughly 1-2 days; the one correctness item you can't skip is per-window state namespacing, and the one accepted limitation is that the agent browser is bound to a single host window.

## Background: how windows work today

- Exactly two top-level windows exist: **main** and **onboarding**, each its own `BrowserWindow` / web contents, both loaded from the same renderer bundle. The renderer picks its root from the `--windowType` preload arg: `main` → `<MainWindow />` (the full multi-tab app in one web contents), `onboarding` → `<App />` (a small fixed-size welcome flow). See `apps/studio/src/client/main.tsx` and `apps/studio/CLAUDE.md` ("Windows").
- The multi-**tab** experience is entirely renderer-side inside the single main web contents; tabs are not separate `BrowserWindow`s.
- `BrowserWindow` is created in two places, both under `windows/`: `createMainWindow()` in `apps/studio/src/electron-main/windows/main/index.ts` and `openOnboardingWindow()` in `apps/studio/src/electron-main/windows/onboarding.ts`. There is no generic multi-window manager; each window type is a module with singleton state.
- Single-instance lock is skipped in dev (so worktrees can boot side by side) and enforced in packaged builds: `apps/studio/src/electron-main/index.ts`.

## What's already in our favor

These are why this is not a from-scratch job:

1. **The backend is already multi-client.** The RPC handler upgrades a fresh `MessagePort` per renderer, keyed by `webContentsId`, on each `start-orpc-server` IPC message: `apps/studio/src/electron-main/rpc/initialize.ts` (`ipcMain.on("start-orpc-server", …)`), context shape in `apps/studio/src/electron-main/rpc/context.ts`. The onboarding window proves two web contents drive the same backend at once.
2. **The workspace actor, ai-gateway, and servers are shared process singletons** created once at boot (`apps/studio/src/electron-main/lib/create-workspace-actor.ts`) and handed into every renderer's RPC context. Multiple windows are just multiple views onto the same backend — no change needed.
3. **A window is trivially cloneable.** `createMainWindow()` does `loadURL(studioURL("/"))` with `additionalArguments: ["--windowType=main"]`; the renderer keys off `window.api.windowType`. Spinning up a second one renders a second full app.
4. Window bounds/zoom persistence, the menu system, and window controls already exist and mostly just need to stop assuming a single window.

## Blockers, ranked by effort

### 1. Renderer state shares one `localStorage` origin — the real work

`tabsAtom` is `atomWithStorage("studio.tabs.v1", …, localStorage)` (`apps/studio/src/client/atoms/tabs.ts`). Two main windows share one origin, so they'd read and write the same tab set and clobber each other last-writer-wins on persist. Each window needs its own tab namespace.

**Fix:** mint a per-window id in the main process and pass it through the preload `additionalArguments` (exactly like `--windowType`), then key per-window storage on it (e.g. `studio.tabs.<windowId>`). Thread the id through `main.tsx` into the atom's storage key. Anything else that is conceptually per-window and currently `localStorage`-backed needs the same treatment; `zoomAtom` (`apps/studio/src/client/atoms/zoom.ts`) is a global preference and can stay shared. This is the core of the effort.

### 2. `mainWindow` is a singleton

`apps/studio/src/electron-main/windows/main/instance.ts` holds one `mainWindow` var behind `getMainWindow()` / `setMainWindow()`; a second `createMainWindow()` overwrites it and orphans the first. Every window control (minimize/maximize/zoom/traffic-light positioning/back-forward) resolves via `getMainWindow()` (`apps/studio/src/electron-main/windows/main/controls.ts`), as do the menu (`apps/studio/src/electron-main/menus/index.ts`, `getFocusedWindowType`) and completion notifications (`apps/studio/src/electron-main/lib/agent-completion-notifications.ts`).

**Fix:** replace the single var with a registry (set of main windows), and make controls/menu act on the sender or focused window rather than "the" main window. Mechanical but spread across several files.

### 3. The menu command bus broadcasts to every main renderer

Menu accelerators call `sendAppCommand` → `commandPublisher.publish("app.command", …)` (`apps/studio/src/electron-main/app-command.ts`, `apps/studio/src/electron-main/rpc/publisher.ts`), and every main renderer subscribes via `appCommands.live.commands` (`apps/studio/src/client/hooks/use-app-commands.ts`). With two windows, `Cmd+T` / `Cmd+W` / navigate would fire in **both**.

**Fix:** stamp the focused window's `webContentsId` onto the command and filter in the renderer subscription (or publish per-webContents). Well-contained.

### 4. The agent browser is bound to a single host web contents

The browser-view manager is a process singleton with one `hostWebContents`, bound to the main window at `apps/studio/src/electron-main/windows/main/index.ts` (`getBrowserViewManager()?.bindHost(mainWindow.webContents)`); its `<webview>` guests live in that one renderer (`apps/studio/src/electron-main/browser-view/manager.ts`, `bindHost`).

**Decision:** making the agent browser per-window is a real, separate project. For the flagged version, ship with the agent browser owned by the first main window (disabled/unavailable in secondary windows) and note the limitation. Revisit only if multi-window graduates.

### 5. Minor single-window assumptions

- `activate` recreation checks `BrowserWindow.getAllWindows().length === 0` (`apps/studio/src/electron-main/index.ts`).
- The window-state store persists a single window's bounds (`apps/studio/src/electron-main/stores/window-state.ts`); new windows should cascade rather than all restore identical bounds.
- `focusForegroundWindow` / deep-link focus and `second-instance` handling assume one main window (`apps/studio/src/electron-main/index.ts`).

All small.

## Keyboard shortcuts

Current File-menu bindings (`apps/studio/src/electron-main/menus/main-window.ts`): `Cmd+T` New Tab, `Cmd+N` New Task, `Cmd+W` Close Tab, `Cmd+Shift+T` Reopen Closed Tab. Note "New Task" and "New Tab" both just target `/new-tab`; the only difference is reuse-current-tab vs open-a-new-tab.

Native macOS convention (Safari/Chrome/Finder) is `Cmd+N` = New Window, `Cmd+T` = New Tab. Proposed mapping behind the flag:

- `Cmd+N` → **New Window** (new)
- `Cmd+T` → **New Tab** (unchanged)
- `Cmd+Shift+N` → **New Task** (the old `Cmd+N` behavior; `Cmd+Shift+N` is free today)

Trivially adjustable — accelerator strings live in that one menu file. All these bindings should be gated on the flag so a flag-off build keeps `Cmd+N` = New Task.

## Feature flag

Flags are an enum + metadata in `apps/studio/src/shared/features.ts`, persisted in an electron-store (`apps/studio/src/electron-main/stores/features.ts`), exposed over RPC (`apps/studio/src/electron-main/rpc/routes/features.ts`), and toggled in Settings → Features and the dev panel. Add `multi_window`.

Caveat: flags are normally consumed in the **renderer**, but window creation and the menu/accelerators are **main-process**. The main process should read the store directly — there is a commented-out `isFeatureEnabled` helper in `apps/studio/src/electron-main/stores/features.ts` ready to un-comment. Gate both the accelerator remap and the New Window action on that main-side read.

## Implementation steps

1. Add `multi_window` to `shared/features.ts` (enum + metadata) and a main-process `isFeatureEnabled` helper in `stores/features.ts`.
2. Introduce a per-window id: mint it in `createMainWindow()`, pass via preload `additionalArguments`, expose on `window.api`, and namespace `tabsAtom`'s storage key on it. Audit other per-window `localStorage` atoms.
3. Convert `windows/main/instance.ts` from a single var to a registry; update `controls.ts`, `menus/index.ts`, and `agent-completion-notifications.ts` to resolve the sender/focused window.
4. Route app commands to the focused window: add a target `webContentsId` to the command payload and filter in `use-app-commands.ts`.
5. Add a "New Window" action + `createMainWindow()` call; gate the `Cmd+N` / `Cmd+Shift+N` remap on the flag.
6. Handle secondary-window lifecycle: cascade bounds, fix `activate`/`window-all-closed` for N windows, keep the agent browser owned by the first window.
7. Fix the `getAllWindows().length === 0` and `second-instance`/deep-link focus assumptions.

## Verification

- Two windows each keep an independent tab strip across quit/relaunch (no clobber).
- `Cmd+T` / `Cmd+W` / navigate act only on the focused window.
- Agent runs started in either window stream correctly (shared backend, per-window RPC ports).
- Flag off: `Cmd+N` still opens a new task; no New Window affordance.
- Closing one window leaves the other fully functional; quitting still runs the running-agents guard once.

## Non-goals / accepted limitations

- Per-window agent browser (single host window for now).
- Separate onboarding-per-window or multiple onboarding windows.
- Any change to the shared backend (workspace actor, servers) — explicitly out of scope; it already serves multiple renderers.

## Open decisions for the implementer

- Final hotkey mapping (`Cmd+Shift+N` for New Task vs dropping the distinct "New Task" and folding it into New Tab).
- Whether zoom stays a global preference (recommended) or becomes per-window.
- Whether secondary windows without the agent browser should hide browser affordances entirely or show a "browser lives in the main window" state.
