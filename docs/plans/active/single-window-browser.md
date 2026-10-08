# Plan: one window browser

Status: not started. Lands after the chat/task rework merges, as its own change.

## Why

The in-app browser began as something only an agent opened: each task had a browser of its own, keyed by the task's id. The person's browser was later built on the same model as "the browser of the window's id" (`WINDOW_ID`). A task's own browser is gone now (every task drives the window tabs of its chat it holds), so the per-id model has one id left, and every browser API still asks whose browser it is:

- `BrowserConfig.createTarget(id, …)`, `listTargets(id)`, and `getTargetMeta().id`, always `WINDOW_ID`.
- The workspace routes `browser.open`, `browser.close`, `browser.live.presence`, and `browser.events.agentActivity`, each taking an id.
- One `task-browser` machine per id in the workspace machine, and `forceReap` by task id when a task is trashed.
- A target id is `<id>/<session>`, and the `<id>` half is always `window`. It is stored in task records (`browserTabs`), `window.json` (the tab on screen), and the window's kept tabs.

## What changes

Collapse the model into one window browser: a target is named by its tab's session alone, the config and routes lose the id, and the per-id machine becomes the window browser's lifetime. Stored target ids change format with no migration; held tabs from a beta workspace read as closed after the upgrade.

## Lifetime, which is the real work

Today the window holds both leases (`retained` and `visible`) on its browser for as long as it is open (`browser-tabs.tsx`), so no window guest is ever reaped; a guest goes only when its tab closes or the renderer reloads. The lifetime the product wants differs by where the tab is:

- **A tab at the top level, outside any chat:** kept while it is on screen. Off screen for a while, its guest is reaped and the tab reloads its page when it comes back, the way Chrome and Safari discard background tabs.
- **A tab inside a chat:** its own expectations, since a task may be driving it or holding it for the person to see a result. Never reaped while a task holds it; otherwise its policy is to be decided with the rework's model of chats and tasks.

Leases move from one per browser to one per tab, which the single-browser model fits.

What the machine does today must survive: reaping from leases with grace periods, closing the `agent-browser` daemons of sessions that end, and noticing a guest destroyed from outside (a renderer reload).

## Checking it

The machine and the browser manager have unit suites, and the type checker finds every caller of the id-taking APIs. Opening, closing, reloading and reaping tabs, an agent driving a handed tab, and Cmd+Shift+R taking every guest down only show in the running app: walk them with `studio-drive.mjs` on a disposable workspace.
