# Reloading the app destroys every task browser

**Status:** contained. Recorded 2026-08-12.

Reloading the renderer takes every task's browser with it. The page the user was on is gone, the browser comes back at `about:blank`, and the task's `agent-browser` daemon sessions are closed underneath a running agent. This is why the app reload is a developer-mode affordance rather than a chord any user can hit.

## Why it happens

The guest is a `<webview>` element in the renderer's document, deliberately — see [in-app-browser.md](../architecture/in-app-browser.md) for what that buys (capture and CDP input keep working while the guest is parked, which a main-process view does not need but a hidden one does). A document teardown takes its children with it, so a reload is a destroy of every guest in the pool.

What follows is not just the elements going away:

- Each guest's `destroyed` fires, `handleDetach` deletes the main-process entry, and the desired-target set the pool reconciles against empties ([manager.ts](../../apps/studio/src/electron-main/browser-view/manager.ts), [entry.ts](../../apps/studio/src/electron-main/browser-view/entry.ts)).
- Destruction reaches the task's lifecycle machine as `targetDestroyedExternally`, which sends it to `Stopping` — so the machine closes the task's remaining targets and calls `closeAgentBrowserSessionsForSessions` ([task-browser.ts](../../packages/workspace/src/machines/task-browser.ts)). An agent mid-`agent-browser` loses its CDP connection and its session.
- The panel remounts, sees no attached target, and auto-opens a fresh one at `about:blank`.

What survives: the browser profile on disk, so cookies and storage are intact and a re-navigation lands logged in; and `lastUrl`/`lastTitle` per session in the session store ([browser-state.ts](../../packages/workspace/src/lib/browser-state.ts)), so the app still knows the page it lost.

## What has been done about it

Cmd+R means the page in front of the user and nothing else. The foreground browser panel claims the chord through [foreground-browser-registry.ts](../../apps/studio/src/client/lib/foreground-browser-registry.ts), the same way it claims Cmd+F, and with no panel claiming it the chord does nothing ([use-app-commands.ts](../../apps/studio/src/client/hooks/use-app-commands.ts)). The app reload is `reloadApp` (Cmd+Shift+R) alone, in the Developer group, whose chords are bound only in developer mode — so one gate in the accelerator binder decides who can reach it, rather than a second policy sitting in the renderer. The other way back from a wedged app is the button [app-error-fallback.tsx](../../apps/studio/src/client/components/app-error-fallback.tsx) puts on screen when the shell crashes, which is the salvage path Cmd+R was being kept for and the one that is actually discoverable in the situation it is meant for.

That leaves the destruction reachable only where someone is equipped to understand it. It does not make it any less destructive when it happens, which is what the rest of this note is about.

## What would actually fix it

- **Restore the page on reopen.** When a fresh guest attaches with a recorded `lastUrl`, navigate there instead of sitting on `about:blank`. Cheap, and it returns the user to what they were looking at. It does not restore history, scroll, in-page state, or the agent's connection, and it needs a decision about scope: every reopen (including after an idle reap and after the "Reopen browser" button) or only the reload path, and whether an agent should find a page it did not open.
- **Move the guest to a main-process `WebContentsView`.** The only version that survives a renderer reload intact. It also gives up what the pool exists to provide: a native view sits above the renderer's DOM, so every modal, popover, and full-window overlay that currently paints over a parked guest would need explicit z-order handling, on top of per-slot positioning and the paint-host capture path.

## Unverified

Read from the code, not reproduced: the reopen after a reload can race the machine's teardown. `registerTarget` is only handled in the live states, so a `browser.open` that lands while the machine is still in `Stopping` is dropped, and the new guest would be tracked by nothing until the panel's presence subscription spawns a replacement machine — which it only does if the old ref has already been removed. Worth checking before anything else is built on the reopen path.
