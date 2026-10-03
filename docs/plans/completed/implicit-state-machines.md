# Implicit state machines outside the Finder

Status: done. Where an item landed differently from the shape below (the quit cap is one deadline over the whole teardown, a browser entry's phase sits beside `webContents` rather than carrying it, `historySteps` stays a ref, `notify` stays off `UpdatePhase`), the commit says why. The Finder (`extend/file-system.tsx` and its rename and selection seams in `window/computer-page.tsx`) is handled on its own and is out of scope here.

Several pieces of the app grew one edge case at a time into state machines that nobody wrote down: a handful of booleans and refs that together encode a few states, timers that paper over ordering, and comments that each describe one race. This plan names them, ranks them, and says what shape each should take. The rule of thumb used throughout: reach for XState only where there are timed transitions, cancelation, or an actor protocol; a pure reducer or transition function with node tests covers everything else; and leave code alone when it is long but already coherent.

Every line number below was read when this was written. Re-read before acting; several of these files move daily.

## Order of work

1. Chat wake: done-vs-overdue overwrite (possible live bug, small).
2. Quit teardown as an actor.
3. Page edit session as an actor.
4. Browser guest entry phase.
5. Browser tab reconciliation.
6. Prompt editor slash menu.
7. Small tidies: omnibar field reducer, background process status transition, updater `notify` and `verifying`, shared guest navigation hook, `useEffectEvent` sweep.

Each item is its own commit (or small series) and needs no other item first.

## 1. Chat wake: "done" can be overwritten by "overdue"

`packages/workspace/src/lib/chat/wake.ts`.

`checkOverdue` (around 202-235) decides which tasks are working, then awaits `turnStartedAt` and `stillWorkingEvent` (itself several awaits) before calling `schedule`. If `session.done` fires in that window, `onSessionDone` schedules the task's "done" event first, and the overdue event then replaces it, because `schedule` keys pending events by task (`events.set(event.taskId, event)`, around 403). The chat would be told a finished task is overdue. `deliverAskedWake` (around 285-302) has the same check-then-await shape. Inferred from reading, not reproduced.

Do now: in `schedule`, an incoming non-terminal event never replaces a pending terminal one for the same task, with a node test that interleaves `checkOverdue` and `onSessionDone` through a deferred promise. Also re-check `isWorking` after the awaits in `checkOverdue`.

Later, only if this file keeps growing: the four module maps (`overdueReportedAt`, `askedWakes`, `stoppedByChat`, `pending`) become a per-task reducer (`working | askedWake | stopping`) behind a timer port, so the cross rules (an asked wake silences and resets the clock, a finished session cancels the asked wake and consumes `stoppedByChat`) are one function a table test covers.

## 2. Quit teardown as an XState actor

`apps/studio/src/electron-main/lib/create-workspace-actor.ts` (around 235-344), `apps/studio/src/electron-main/lib/quit-guard.ts`, `apps/studio/src/electron-main/windows/app-window.ts` (around 162-171), `apps/studio/src/electron-main/index.ts` (around 206-208).

Implicit states: idle, asking for approval, canceled, approved, closing browser sessions, stopping services, finalizing, exited. Tracked today by `isQuitHandling` and `isQuitInProgress` (two booleans encoding three states, with `finally { if (!isQuitInProgress) isQuitHandling = false }`), `hasExited` and `finalized` latches, `isApproved`/`pending`/`forcedInDev` in `quit-guard.ts`, two hand-rolled timeouts (`forceFinalize` and the 3s cap), and an outside probe of the updater's `installing` status. "Is quit already approved" is answered in three places. Roughly fifteen commits on these files are about quit or teardown.

Shape: one XState v5 actor owned by the main process (XState is already a main-process dependency). `before-quit` sends `QUIT_REQUESTED`; approval is an invoked promise; teardown steps (`closeAllAgentBrowserSessions`, `killAllBackgroundProcesses`, `stopWorkspaceSkillWatcher`) are invoked services; the force-finalize and 3s cap are `after` transitions; the updater's install path sends `QUIT_APPROVED` instead of being probed. `quit-guard.ts` folds into the actor. Tests drive the actor with fake services and a simulated clock: a second quit during teardown is ignored, a canceled approval returns to idle, a hung service still exits on the cap.

## 3. Page edit session as an XState actor

`apps/studio/src/client/components/window/page-edit.tsx` (around 134-418).

One effect runs a protocol session with the page guest: attaching (retry by bumping `attempt` up to `ATTACH_RETRIES`), loading, ready (`hello`), reloading under a captured cover, stopping. A `switch` on message type (around 244-329) handles the protocol, a `latest` ref mirrors six values, and three timers are involved: `setTimeout(resolve, FLUSH_TIMEOUT_MS)` (around 226) and `setTimeout(() => setCover(null), 80)` (around 267), neither cleared on teardown, plus a 6000 ms cover safety timeout (around 407-418).

Shape: an XState actor created per session (the first XState in the renderer; `xstate` is already in Studio's `package.json`, and `@xstate/react` would need adding, or `createActor` plus `useSyncExternalStore`). Retry, cover hold, cover timeout and flush timeout become `after` transitions, which also makes them cancel on stop. The file is young and low-churn, so this is cheap now and will not be later.

## 4. Browser guest entry phase

`apps/studio/src/electron-main/browser-view/manager.ts` (around 353-556), `apps/studio/src/electron-main/browser-view/entry.ts` (around 23-66, 184-233).

An entry is created, accepted by `will-attach-webview` (queued), bound (`webContents` set), loaded (`attach` settled), then destroyed or timed out. Today that is spread as guards: `entry.webContents && !entry.webContents.isDestroyed()` at three sites, `!entry.attach.settled` at three, a FIFO `pendingAttachQueue` that assumes Electron fires attach events in order, `attach` resolved from both `did-fail-load` and `did-finish-load`, and a timeout that destroys only `if (!entry.attach.settled && !entry.webContents)`.

Shape: not XState. An `entry.phase` discriminated union (`pending | bound | live | gone`) with one `transition(entry, event)` function and node tests per Electron callback order, including the out-of-order attach case. The guards collapse into phase checks.

## 5. Browser tab reconciliation

`apps/studio/src/client/components/window/browser-tabs.tsx` (around 302-620).

The set of attached guests is reconciled against the tab list across five effects and four mutable Set refs: `closingGuests` (close requested once), `bootTabIds` and `restored` (restore once), `seenTargets` (a closed guest never returns as a newcomer), and `historySteps` (an "ignore the next navigate" flag added on back/forward and consumed on navigate). An orphan grace `setTimeout` (around 448-459) and a `latest` ref mirroring five values round it out.

Shape: a pure `reconcileGuests({ tabs, attached, memo }) → { close, open, add, memo }` with node tests, called from one effect. `historySteps` becomes a field on the tab (`pendingHistoryStep`) rather than a ref.

## 6. Prompt editor slash menu

`apps/studio/src/client/components/prompt-editor.tsx` (around 219-391).

The slash menu's state is held twice: `menu` state plus `menuRef`, `selectedIndex` plus `selectedIndexRef`, a `scrollToSelectionRef` "the keyboard moved it" flag, and six more refs mirroring props. Closing the menu is `menuRef.current = null; setMenu(null)` in four places. Keyboard handling is an if chain over open or closed.

Shape: the menu (`{ from, to, query, index }`) becomes a ProseMirror plugin's state, so transactions own it and React reads it through the plugin; the mirrored refs go away. Failing that, a pure reducer. `prompt-editor.test.ts` and its browser test already cover the surface, so extend those rather than adding a new harness.

## 7. Small tidies

Each is a single focused commit, worth doing when someone is already in the file.

- **Omnibar field** (`window/omnibar.tsx`, around 204-216 and 386-489): `query`, `highlight`, `canComplete`, `isEditing`, `isFocused`, with the same partial reset written in `onBlur`, `onChange`, `takeShown` and Escape. A pure `omnibarField(state, event)` beside `omnibar-match.ts` and its test.
- **Background process status** (`packages/workspace/src/lib/background-processes.ts`, around 767-940): `finish` and `stopRecord` each decide the next status, and `finish` has a late-exit branch that re-enters a terminal state. One pure `nextStatus(record, outcome)`; leave the rest, which is well reasoned and tested.
- **Updater `notify` and `verifying`** (`apps/studio/src/electron-main/lib/create-app-updater.ts`): `notify` is shared and written by `checkForUpdates`, `verifyLatestVersion` and the poll, and `runPoll` skips only while `installing`, not while `verifying`, so a background poll can reset `notify` during a user-initiated verify. Fold both into the existing `phase`. The updater's pure-decision-plus-port split (`update-status.ts`) is the model the other items here follow; this closes the gap in its shell.
- **Guest navigation hook**: `task/browser-panel.tsx` and `window/browser-tabs.tsx` both mirror a guest's URL and `canGoBack`/`canGoForward` with a try/catch on "not attached". Extract `useGuestNavigation(targetId)`; leave the rest of `browser-panel.tsx`, which is deliberate.
- **`useEffectEvent` sweep**: about forty lines of "latest ref plus effect" mirroring in `prompt-editor.tsx`, `window/compose-window.tsx`, `window/right-pane.tsx` and `studio-sidebar-rail.tsx`. React 19.2's `useEffectEvent` is already used in the repo (`ask-popover.tsx`, `use-copy-shortcut.ts`).

## Looked at and left alone

- CDP bridge (`packages/workspace/src/logic/server/routes/cdp-bridge.ts`): the load and local-file gates are already small factories. One nit worth a line in a later commit: `releasePending` is a single slot, so a second held navigate orphans the first until its cap timer fires.
- `window/tab-strip.tsx`: the render-phase diff and two motion timers are coherent enter and exit bookkeeping; the layout counts tabs still collapsing, which AnimatePresence would not.
- `window/compose-window.tsx`: long, but mostly the mirrored-ref pattern the sweep above covers, not mode flags.
- `document-viewers/data-grid.tsx`, `task/chat.tsx`, `prompt-input.tsx`, `focus-guard.ts`, `page-editor/sessions.ts`: state is small, local, or already uses a generation pattern.

## Rename, built four times

Inline rename exists separately in `hooks/use-inline-rename.ts`, `window/use-chat-rename.ts`, `window/compose-zero-state.tsx` and the Finder. Once the Finder's rename has an explicit model, check whether the chat and bookmark renames can share its commit/cancel/blur rules; do not merge them before then.
