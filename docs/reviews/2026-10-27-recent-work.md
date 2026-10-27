# Recent work after the 10-24 review

Reviewed: `acc5ab7ec..a6c1e8986` (224 commits; 619 files changed, 30,619 insertions and 9,173 deletions).

The starting point is the head the 10-24 review recorded; the 10-27 beta 109 pass in between ran the packaged app rather than reading code. Five blind readers took one area each, following `REVIEW.md`: agent shell and containment; drafts, the phone's chat list, outside links and moving the Instrument folder; privacy, secrets, sign-in and app OAuth; Files, the Excalidraw canvas and page guests; updates, quitting, agent turns and the landing tools. Every finding below was re-read at `a6c1e8986` by the reviewer who wrote this file, and checked against `docs/decisions/`, the declined findings here, and the `Rejected:` and `Commits-to:` trailers of the commits that introduced it; none reverses a record. Five of the six Important findings come from code that landed in this range with a `Not-tested:` trailer covering the path the finding is on.

## Findings

### A. A draft a phone asks this computer to send goes without its context

- Status: open
- Where: [start-workspace.ts:54](/apps/studio/src/electron-main/lib/start-workspace.ts#L54), [send-asked-drafts.ts:76](/apps/studio/src/electron-main/drafts/send-asked-drafts.ts#L76), [message.ts:156](/packages/workspace/src/rpc/routes/message.ts#L156)
- What: the `send` callback passes only `words`, `fromDraft`, the chat and the topic to `message.create`. A window's send also passes `viewing` from the draft's `context` lines and the composer's outside `files`/`folders`; `withDraftFolder` adds only entries inside the draft's own folder. So a new-chat draft started on `~/Reports/q3.xlsx` and sent from the phone reaches the agent as bare words, and marking it sent removes `DRAFT.md`, so the `context` lines are gone with nothing to say they were dropped. The docblock says the draft "is sent as a window sends one".
- Verification: traced statically, confirmed by reading the route's input.
- Fix: read the draft's `context` in main and pass it as `viewing` (and its outside paths as `files`/`folders`), through the same helper the window uses.
- History: `3cd70ce12` (replies), extended to new-chat drafts by `4cbae5d0b`. Both carry `Not-tested: never run in the app`.

### B. Closing a drawing while its save conflicts merges against the emptied canvas

- Status: fixed
- Where: [excalidraw-session.ts:146](/apps/studio/src/client/components/excalidraw-editor/excalidraw-session.ts#L146), [excalidraw-session.ts:292](/apps/studio/src/client/components/excalidraw-editor/excalidraw-session.ts#L292)
- What: `16c7ef2d5` moved saving onto the `canvas` snapshot because Excalidraw empties its scene on unmount before the close's flush runs. `mergeIn` still reads the person's side from the live API (`getSceneElementsIncludingDeleted`, `getFiles`, `getAppState`). When the agent wrote the file and the person's last edit is still in the debounce at close, `destroy()` flushes, the write comes back stale, and `mergeScene` runs with `ours = []`. If the agent only edited or deleted elements, nothing is "changed", `canvas` keeps the person's pre-merge copies and the resave writes them over the agent's edits and brings back what it deleted. If the agent added an element, `canvas = readCanvas()` reads the empty scene plus the additions, and the person's last edit is lost.
- Verification: traced statically; the empty-scene premise is `16c7ef2d5`'s own.
- Fix: read `canvas.elements`, `canvas.files` and `canvas.appState` in `mergeIn` (and in `busy()`).
- History: `00d98e42b`; `16c7ef2d5` fixed the save half only. `Commits-to: a save rewrites only elements the canvas changed` is what this breaks.

### C. On the first drawing opened, an element the agent deletes comes back

- Status: fixed
- Where: [excalidraw-session.ts:241](/apps/studio/src/client/components/excalidraw-editor/excalidraw-session.ts#L241), [scene-sync.ts:243](/apps/studio/src/client/components/excalidraw-editor/scene-sync.ts#L243)
- What: `remeasureTextOnceFontsLoad` resizes every text once the fonts load, but the merge base (`disk.scene.elements`) was restored before the fonts and is not re-derived. Until the next successful save, every text differs from its base by width and height. An agent deleting a text then hits "the agent dropped an element the person was changing", which keeps it, counts a conflict, and writes it back, with a "your changes were kept" toast for an edit the person never made. An agent rewording a text gets a false conflict on its size the same way.
- Verification: the merge half by probe (base width 10, canvas 12, theirs `[]` gives the element kept and one conflict); the remeasure resizing is traced statically and stated by its own comment.
- Fix: after a remeasure that resized anything, re-derive the base the same way (restore `disk.scene` with the loaded fonts).
- History: `6d7ace263`.

### D. On Linux the agent's programs can write `Drafts/` while it does not exist

- Status: fixed
- Where: [bwrap.ts:291](/packages/workspace/src/lib/native-sandbox/bwrap.ts#L291), [workspace-fs-layout.ts:949](/packages/workspace/src/lib/workspace-fs-layout.ts#L949)
- What: `bwrapArgs` makes a missing path before binding it only when it is in `ours` or allowed by name; otherwise it skips the rule. The workspace's top folder is not in `ours`, so the read-only `Drafts/` rule emits nothing in a workspace with no drafts yet (which has no `Drafts/` folder), and the workspace folder bound around it is writable. `python -c` making `Drafts/x/DRAFT.md` with this computer under `send` then gets the draft sent and a turn started that nobody asked for. Seatbelt denies the path whether or not it exists, MXC keeps a missing path whose parent exists, and the shell and file tools refuse by path; only bubblewrap leaks.
- Verification: by probe (no `Drafts` entry in the bubblewrap arguments with the folder absent; `--ro-bind` with it present).
- Fix: make `Drafts/` when the workspace starts, or treat a missing read-only path under a writable bind like `ours` and make it before binding.
- History: `4cbae5d0b`, whose `Commits-to: the agent can read Drafts/ and never write it` this breaks. The threat model's "one chat affecting another" is otherwise undefended inside the workspace; this is reported because the commit draws that line and three of four layers hold it.

### E. "Restarting" stays up after an install that fails late

- Status: fixed
- Where: [use-install-update.ts:14](/apps/studio/src/client/components/use-install-update.ts#L14), [use-install-update.ts:32](/apps/studio/src/client/components/use-install-update.ts#L32), [update-status.ts:260](/apps/studio/src/electron-main/lib/update-status.ts#L260)
- What: `restarting` is set on the press and cleared only when the RPC itself returns something other than `installing`. On macOS a Squirrel failure arrives after `quitAndInstall` returned (the `failed` handler says so and publishes `error`), so the flag stays true. The next poll's `checking` resolves to `downloaded` while a build is staged, and `showsAsRestarting(true, "downloaded")` draws the pill as "Restarting" with a spinner and Settings' button as a disabled "Restarting…" for as long as the window lives. Clicking the pill still installs, but nothing invites that.
- Verification: traced statically.
- Fix: clear `restarting` on a published `error`, or derive it from the status having been `installing`.
- History: `354e8cf54` (`Not-tested: the hold, the fade, and both relaunch notices in a packaged build`).

### F. A drawing's background or grid change made during a save is dropped

- Status: fixed
- Where: [excalidraw-session.ts:116](/apps/studio/src/client/components/excalidraw-editor/excalidraw-session.ts#L116)
- What: after the write resolves, `syncedSettings = settingsOf(canvas.appState)` reads the canvas as it is now, not as `text` was built at line 104. A background change while the write is in flight becomes the synced value, the next `canvasText()` sees no settings change, and the status says "saved" with the change never written. Elements are unaffected.
- Verification: confirmed by reading.
- Fix: capture the settings beside `text` before the await.
- History: `16c7ef2d5`.

### G. The sent-link title fetch can reach this computer's network (Nit)

- Status: fixed
- Where: [page-title-fetch.ts:20](/apps/studio/src/electron-main/browser-view/page-title-fetch.ts#L20), [page-title-fetch.ts:67](/apps/studio/src/electron-main/browser-view/page-title-fetch.ts#L67)
- What: `isPublicPage` checks only the address sent, and the fetch follows redirects with no further check, so a shortened link redirecting to `http://192.168.1.1/…` gets a GET from main. The suffix check also misses a trailing dot (`http://localhost./`, `http://router.local./`), and a name resolving to a private address passes. The comment promises such pages are never asked. A Nit: only the person's own sent words start it, and the threat model leaves the network open.
- Verification: trailing dot by probe; redirect and DNS traced.
- Fix: `redirect: "manual"` with `isPublicPage` at each hop, and strip a trailing dot first.
- Note: a public name that resolves to a private address still passes; checking that means resolving the name before the request, which was left out.

### H. The phone's chat list can be written empty just after launch (Nit)

- Status: open
- Where: [chat-list-file.ts:119](/packages/workspace/src/lib/chat/chat-list-file.ts#L119)
- What: a `session.done` before the live list first yields (a resumed background job) fires `write()` with `latest = []` and `written` undefined, so `chat-list.json` gets `chats: []` and a fresh `writtenAt`, and a phone taking the newest file shows no chats until the first real read rewrites it.
- Verification: traced statically.
- Fix: write nothing until the list has been read once.

### I. The macOS `log` classifier parses options as `getopt_long`, where `log` uses `getopt_long_only` (Nit)

- Status: open
- Where: [unsandboxed-log.ts:14](/packages/workspace/src/lib/shell-commands/unsandboxed-log.ts#L14)
- What: `log` reads `-pager` as `--pager` and `-predicate=…` as `--predicate`, while the classifier reads `-p` with attached text, so both run outside the sandbox unexamined. No allowed short letter begins a file-reading option (`-archive` is still refused) and `log` rejects FUNCTION and SUBQUERY predicates itself, so nothing reaches further today.
- Verification: by probe (`classifyLog(["show","-pager"])` allowed) and against `/usr/bin/log`.
- Fix: treat a single-dash word longer than one letter as a long option.

### J. Faded windows come back before an install's quit finishes (Nit)

- Status: fixed
- Where: [update.ts:437](/apps/studio/src/electron-main/lib/update.ts#L437)
- What: `FADE_RESTORE_MS` (10 s) is shorter than the quit teardown's deadline (about 11 s plus the hold and fade), so an install started with work running brings the windows back at full opacity just before the app exits. Cosmetic.
- Verification: traced statically.

## Confirmed

Read and found correct, so the next review can leave them: `commit.sh --amend` (refuses off the tip or once pushed, compare-and-swap `update-ref`) and `land.sh` (untracked files, subfolder runs, registry pin after rebase); Squirrel.Mac staging against electron-updater's `MacUpdater`; quit by signal and the unclean-exit record; the just-bash shell options patch and the `&` refusal inside `bash -c`/`sh -c`/`eval`; Linux signals staying inside bubblewrap; the browser screenshot read through the chat's rules; problem reports redacted again with every account signed in; feedback images re-checked by bytes in main; the new provider key prefixes; the app token refresh race keeping a newer sign-in; the draft store's claim/sent/release flow and trash confinement; outside links (`new` only drafts, `file` checked and never run); trashing a chat's own folder; the Instrument folder pick and `unmake`; the page guest preload exposing nothing to the page; protected folders' argument order; SVG thumbnails under `default-src 'none'`; Excalidraw and the CodeMirror grammars in `devDependencies`.

## Not covered

- Files search tokens (`344b07f6b`, `d1b566685`), the titled list (`257e71daf`), `keyboard-home.ts`, `look-panel.tsx`, `folder-trail.tsx`, the thumbnail speedups (`6961344f7`) and the Excel values worker (`814b1dee7`).
- `storage-section.tsx` and the setup folder step beyond the shared pick checks; `feedback-dialog.tsx` beyond its defaults and capture; `report-redaction.ts` internals.
- `a1149daa8`, `85f4a9aa0`, the chat-title commits (`eaafc9fce`, `f5e513678`), the Studio half of the tab request (`c3b20ebb9`, `0c109d6a2`), and the patched just-bash bundle beyond its `bash.ts` hunks.
- Two leads the drafts reader could not substantiate: a phone-asked new-chat draft brought back by a sync conflict being sent again after a relaunch inside `ASK_FRESH_MS`, and an empty topic note racing another device's earlier one.
