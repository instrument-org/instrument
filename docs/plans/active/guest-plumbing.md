# Plan: one owner for each fact about a browser guest

Status: in progress.

Every guest of the in-app browser shares one Electron session, so each feature that hooks the session (the local-file policy, downloads, ad blocking, the page editor's `file` handler) has worked out on its own which guest a request or a download came from, and each wired itself onto the session behind its own "already done" set. The renderer hands the raw `<webview>` to a dozen callers that each guard "not attached" by hand, keyboard chords for a page are routed by three different rules, the page editor speaks a hand-rolled protocol, four paths capture a frame, CDP overrides are split across two processes with no list of them, and the ChatGPT sign-in has been fixed on top of fixes. The shared profile itself is a decision ([workspace-browser-profile](../decisions/2026-07-13-workspace-browser-profile.md)) and stays.

Each step is one or more commits that keep types, lint and the Studio and workspace suites green.

## Steps

1. **Guest registry and one session setup** (`electron-main/browser-view/guest-registry.ts`). One record per web contents in a browser session the app configures, keyed by webContents id: role (`webview`, `popup`, `picture`), the browser entry a webview is bound to (target, task, download authorization), the committed document per frame, the page being edited. Ad-block exemption by task lives beside it. `configureGuestSession()` runs once per process and registers every hook the session has; `sessionForEntry` and the three wiring `WeakSet`s go, as do `taskOfGuest`, `unblockedTasks`, `findEntryByWebContents`, the popup recursion, and the editor's own `watched` set. `rendered-pictures.ts` reads the same registry and the same local-file answer, so its pages get the symlink check the guests have. Checks: unit tests for the registry, the request answer, downloads and the editor's address lookup; the app (a site and a local file in tabs, restore after reload, a download, Edit on a local page).
2. **`captureFrame(wc, {deadline, forceDraw, rejectEmpty})`** in main, used by the agent's screenshot, the screencast, tab thumbnails and rendered pictures (the offscreen Linux path included). Thumbnails get a deadline. Checks: unit tests over a fake contents (retry, deadline, empty frame, forced draw); a screenshot through agent-browser if reachable.
3. **One table of CDP methods** (`packages/workspace/src/lib/cdp-methods.ts`): every method agent-browser sends, each marked passthrough, override or refuse and which side handles it (bridge or main). `dispatch-command.ts`'s if-chain becomes a handler map keyed by that table; tests fail when either side handles a method the table does not mark for it, and when agent-browser's own method list names one the table does not know.
4. **Page editor protocol**: a request/response helper over the guest channel (ids, a timeout, a reply even when the handler throws) used both ways (save, flush); saves and the external-change read go through `createSaveQueue`, and the file watch is `usePullOnDiskChange`. Checks: helper and queue unit tests; Edit on a local page in the app.
5. **Typed guest handle**: the pool returns `GuestHandle | null` (null until the guest is ready) with step, reload, send, capture, find, zoom; the raw element is not exported, and a lint rule keeps `<webview>` out of everything but the pool. Call sites change mechanically, so the window-tabs refactor merges cleanly. Checks: pool tests; the app.
6. **Chord routing**: main forwards every page-scoped chord (reload, zoom, back, forward, find) as a `window.command`; one renderer function says which page a chord means. Main's focus record stops routing chords, so an agent's click no longer decides where Cmd+R lands. History stepping itself is not redesigned here. Checks: resolver unit tests.
7. **ChatGPT grant machine**: an XState machine per registration (signed out, awaiting callback, active, refreshing, revoked) whose only writer is `saveUnlessReplaced`, and one typed outcome shared by the callback page, the buttons and Google sign-in. Checks: machine tests over a fake clock and fake token endpoint. A live sign-in needs real accounts and is not run.

When done: `docs/architecture/in-app-browser.md` describes the registry, the session setup, the capture and CDP tables, and this file moves to `completed/`.

## Out of scope

- Back and forward across tabs (the tab and history model), which is being refactored on its own.
- Giving guests separate sessions.
- The workspace's records and RPC beyond the CDP table.
