# Recent work after the 11-06 review

Reviewed: `820806035fcf85e13962f1ef942e7f8a21f4f025..f0d6cf2fe` (585 commits; 1,456 files changed, 123,997 insertions and 19,347 deletions).

The starting point is the last range review's recorded head; the two reviews since (upgrade and first launch, single source of truth) were lens snapshots and did not read new code as such. This was a risk-focused review following `REVIEW.md`. Seven delegated readers, each blind to this folder, took the in-app browser and outside links, the rest of the main process, chat records and stores, agent commands and containment, the transcript and chat surface, the rest of the renderer, and the Claude account provider plus repo scripts. The multi-window code up to its merge at `76c920451` has four reviews of its own, so only its later changes were read. The coordinating reader re-read every cited line at the reviewed head and checked each survivor against declined findings here, the `Rejected:` and `Commits-to:` trailers on the commits that touched those lines, and `docs/decisions/`; none reverses a record. Every finding is a static trace. Nothing was run, and existing working-tree edits were excluded.

Fourteen Important findings and five Nits survived. None loses a chat's records, widens what the agent can reach, or crosses the renderer's privilege boundary: those paths were traced and held (see Confirmed tradeoffs). What did turn up clusters in the newest code, where a second path was added beside a first and the two do not share a rule: the mic and camera state is kept by the top frame alone, the transcript has a guarded and an unguarded way to load older turns, a draft has two definitions of empty, and Activity has a live read whose refill was never written.

## Severity

Important means a concrete correctness, security, privacy, or data-preservation defect that should be fixed before shipping. Findings are ordered by consequence: A to F are things a person runs into in ordinary use, G to K have a narrower trigger or a smaller cost, and L to N are hygiene with a real but rare path. Nits follow, capped at five.

## Findings

### A. A call in an embedded frame uses the mic or camera with no mark on the tab and no Stop

- Status: fixed `16b10802f`
- Severity: Important. The in-use mark and Stop are how a person knows a page is listening; for a frame they are absent, and the app's own guards act as though the tab were idle.
- Where: [preload.ts:411](/apps/studio/src/page-editor-guest/preload.ts#L411), [page-capture.ts:211](/apps/studio/src/electron-main/browser-view/page-capture.ts#L211), [page-capture.ts:361](/apps/studio/src/electron-main/browser-view/page-capture.ts#L361), [extension-open-tabs.ts:216](/apps/studio/src/electron-main/browser-view/extension-open-tabs.ts#L216).
- What: what a page is capturing is known only from a wrapper around `getUserMedia` that the guest preload installs in the top frame's world (`contextBridge.executeInMainWorld`), and a preload runs in the main frame alone (`nodeIntegrationInSubFrames` is off, and a test pins that). The permission side takes no account of the frame: `handleMediaRequest` reads `details.securityOrigin` and `mediaTypes` only, so a request from an iframe is asked and granted like any other. A page that embeds a meeting widget, or calls `getUserMedia` through a same-origin frame's `contentWindow`, is granted the mic and never reports using it. The tab shows no mark and offers no Stop or Pause, `anyPageCapturing` is false so an idle restart can end the call, and Stop on a page that did report reaches only the tracks the top frame's wrapper knows.
- Note: the same cooperative signal is missing altogether from one guard. Installing an extension reloads every tab its content scripts reach unless the tab is audible, full screen, edited, driven or has unsaved input (`playing: contents.isCurrentlyAudible()`), so a call where nobody is speaking at that instant is reloaded even when its capture was reported. The fix for both is main-side state: record the grant per guest when `handleMediaRequest` allows it and treat that as "may be capturing" wherever the wrapper's report is read today.

### B. The monthly sweep can delete the transcript the first message after launch is resuming from

- Status: fixed `15547baa6`
- Severity: Important. The first Claude account message of a launch, in a chat left for a month, can fail or start without its conversation.
- Where: [language-model.ts:190](/packages/ai-gateway/src/lib/providers/claude-account/language-model.ts#L190), [language-model.ts:89](/packages/ai-gateway/src/lib/providers/claude-account/language-model.ts#L89), [resume-record.ts:293](/packages/ai-gateway/src/lib/providers/claude-account/resume-record.ts#L293).
- What: `sweepOnce(configDir)` is the first line of a step and starts `sweepResumeRecords` without waiting for it. The same step then reads its slot's record, checks the transcript and plans a resume. When that record is thirty or more days old, the sweep removes the record and its transcript while Claude Code is being started on it. The step's one read beats the sweep's `readdir`, `stat` and `readFile`, so the plan is made from a file that is gone by the time it is used. The slot being planned is exactly the one a sweep by age picks.
- Note: await the sweep before planning, or pass the sweep the slot the step is about to read so it skips it; the step's own write then makes the record fresh. The commit's `Not-tested:` line already says no real month-old folder was swept.

### C. Whether a refused resume clears its record depends on Claude Code's wording

- Status: fixed `15547baa6`
- Severity: Important. `REVIEW.md` names this shape under Brittleness, and the cost when it breaks is a chat that fails on every request.
- Where: [language-model.ts:621](/packages/ai-gateway/src/lib/providers/claude-account/language-model.ts#L621), [language-model.ts:396](/packages/ai-gateway/src/lib/providers/claude-account/language-model.ts#L396).
- What: `RESUME_REFUSED = /No message found with message\.uuid/` is tested against `String(error)`, and only a match removes the record so the slot starts cold. The executable is the person's installed Claude Code, which this repo does not pin. A reworded message, or any other resume failure that a retry does not change (B's missing file among them), leaves the record in place; only a finished step moves it, so every later request for that chat plans the same resume and fails the same way until the month's sweep.
- Note: a rule with no text in it covers both cases: a resume that fails before the process has written any assistant entry drops the record.

### D. A page of older turns can be loaded and drawn twice

- Status: fixed `e9768e32e`
- Severity: Important. The transcript shows a stretch of the conversation twice, with duplicate row keys, until the chat is reopened.
- Where: [use-transcript-feed.ts:95](/apps/studio/src/client/components/transcript/use-transcript-feed.ts#L95), [use-transcript-feed.ts:75](/apps/studio/src/client/components/transcript/use-transcript-feed.ts#L75), [feed.ts:261](/packages/workspace/src/lib/transcript/feed.ts#L261).
- What: `loadOlder` refuses to start while `isLoadingOlder` is set; `loadOlderThrough`, which find in chat uses to reach a turn that is not loaded, sets the flag and never reads it. Both ask for the page before the first message they hold, and `applyOlder` prepends whatever comes back (`[...older.messages, ...current.messages]`) with no check that it is already there. Scroll near the top so the sentinel starts a load, then step find to an older match before it lands: both requests carry the same `before` and the page goes in twice. The window is wider than one request, since `loadOlder`'s own `finally` clears the flag while `loadOlderThrough` is still looping, which lets the sentinel start another.
- Note: one in-flight promise both callers await closes it; dropping messages `applyOlder` already holds makes it safe whatever the callers do.

### E. A failed reply keeps its Try again after a wake carries the chat on

- Status: fixed `e75b14a31`
- Severity: Important. The cached fold and a fresh fold of the same records disagree, so what is on screen changes when the chat is reopened.
- Where: [turns-of.ts:218](/packages/workspace/src/lib/transcript/turns-of.ts#L218), [turns-of.ts:226](/packages/workspace/src/lib/transcript/turns-of.ts#L226), [turns-of.ts:598](/packages/workspace/src/lib/transcript/turns-of.ts#L598).
- What: a cached turn is rebuilt when being followed changes it, which the cache reads from `holdsLast`. The range changed that from "no turn follows" to `index >= lastTyped`, so a wake's own turn (which `turnSlices` now opens when the turn above ended in words) does not count as following. A reply that streamed some words and then failed has an error row built with `isLastMessage: true`. When a task finishes or a permission is answered, the wake opens a slice below it; the errored turn's slice, `isLive`, `cutAcross` and `holdsLast` are all unchanged, so the kept turn is returned with the error still marked last, while `buildTurn` run fresh computes `message.id === lastMessage?.id` as false. The error card keeps its actions under a reply that has moved on, and a capacity error's card, drawn only while last, stays up until the chat is reopened.
- Note: the row reads `lastMessage`, not `writtenPast`, so the cache key has to carry what the row depends on: keep whether the turn held the last message and rebuild when that changes.

### F. Activity leaves out everything past the newest 200 rows since the page opened

- Status: fixed `f1cac2a0b`
- Severity: Important. Rows are missing from the middle of the list with nothing to say so.
- Where: [activity-page.tsx:82](/apps/studio/src/client/components/activity/activity-page.tsx#L82), [activity-page.tsx:217](/apps/studio/src/client/components/activity/activity-page.tsx#L217), [activity-page.tsx:282](/apps/studio/src/client/components/activity/activity-page.tsx#L282), [activity-page.tsx:439](/apps/studio/src/client/components/activity/activity-page.tsx#L439).
- What: the page reads history up to `until`, the moment it opened, and polls what came after with `limit: LIVE_LIMIT` (200), newest first. The constant's comment says that past the limit "the page is read again from now", but `setUntil` is called in one place, `startOver`, which only a removal or Clear reaches. With the tab left open through a long task (more than 200 model requests) or more than 200 actions, the list shows the newest 200 and then jumps to rows from before the tab opened. The same fixed `until` names the days (`withDayHeads(shown, new Date(until), …)`), so a tab open across midnight heads two days "Today".
- Note: when either live read comes back full, call `startOver`'s `setUntil(Date.now())`; that moves the day names too.

### G. Linux with no GTK bookmarks file unpins every default folder, once and for good

- Status: open
- Severity: Important. A missing file is read as "the system pins nothing" and the result is written and never retried, on upgrade as well as first launch.
- Where: [system-sidebar.ts:32](/apps/studio/src/electron-main/lib/system-sidebar.ts#L32), [system-sidebar.ts:99](/apps/studio/src/electron-main/lib/system-sidebar.ts#L99), [sidebar-places.ts:109](/apps/studio/src/shared/sidebar-places.ts#L109).
- What: `systemSidebarFolders` returns `undefined` for "could not read", which `adoptSystemSidebarOnce` leaves for the next launch. On Linux a failed read of `~/.config/gtk-3.0/bookmarks` returns `[]` instead. `adoptSystemSidebar` then unpins each default the system list leaves out, which is all of them, and `systemSidebarAdopted` is set. A KDE desktop, or any account that never added a bookmark in a GTK file manager, opens Files with only the output folder pinned. Nothing is lost and the defaults can be pinned again by hand.
- Note: return `undefined` when the file is absent. The commit's `Not-tested:` line says Linux was never run on a real desktop.

### H. A draft with only chips, a chosen project or tabs is announced as saved, not listed, and removed at the next launch

- Status: declined
- Severity: Important. The toast promises something the next launch deletes, and what goes is what the person gathered for a message.
- Where: [use-drafts.ts:323](/apps/studio/src/client/components/window/use-drafts.ts#L323), [drafts.ts:328](/apps/studio/src/shared/drafts.ts#L328), [drafts.ts:343](/apps/studio/src/shared/drafts.ts#L343), [app-window.tsx:621](/apps/studio/src/client/components/window/app-window.tsx#L621).
- What: closing a draft keeps it unless `isLeftEmpty`, which counts `context`, a chosen project and tabs in its group as content, and then toasts "Your draft is saved in Drafts". The Drafts list and the launch sweep both use `holdsSomething`, which counts only words, attachments and files in the folder. Ask about a file from Files, which the range made write a `context` line, then close the draft window without typing: the toast's View opens a list without it, and the first window of the next launch drops its tab group and removes it.
- Declined because: the drafts feature is about to change shape, and the rule for an empty draft will be settled there; revisit if this toast and sweep survive that change.
- Note: both rules predate the range; the range edited `closeDraft` and made context-only drafts an everyday thing. One predicate for all three places ends it, whichever way the product wants it.

### I. A dot in a file or folder name sends the rest of the name with feedback

- Status: open
- Severity: Important. Privacy: part of a name reaches a report through a function whose contract is that no name does.
- Where: [problem-reports.ts:769](/apps/studio/src/electron-main/lib/problem-reports.ts#L769).
- What: `pathKind` answers `a .<everything after the last dot> file`. A folder named `Dr. Patel records` goes into a report's actions as `a . patel records file`, and `Offer letter.Jane Doe` as `a .jane doe file`. The redactor removes only values it knows (people, the home folder, the login, chat ids, memories). The person can leave the actions out and the dialog shows them, which bounds it.
- Note: accept an extension only when it looks like one, for example `/^[a-z0-9]{1,8}$/`, and answer "a file" or "a folder" otherwise.

### J. Tab asks and their answers written by 2.0.0 no longer read

- Status: declined
- Severity: Important by the rule that a changed stored shape still reads what the previous release wrote; the cost is small.
- Where: [message-data-part.ts:1051](/packages/workspace/src/schemas/session/message-data-part.ts#L1051), [message-data-part.ts:1064](/packages/workspace/src/schemas/session/message-data-part.ts#L1064).
- What: `edc672378` changed `PermissionOnSchema` from `["app", "folder", "tab"]` to `["app", "folder", "page"]` and dropped `gone` from the answer. The range's base is in the `v2.0.0` tag, so released builds wrote `ask` records with `on: "tab"` and `data-permissionAnswer` parts with `kind: "tab"`. An `ask` line that fails to parse is skipped, so one open at the upgrade disappears with no close and no wake; an answer part reads as `data-unknown`, which the model no longer sees and the transcript shows only in developer mode. The lines on disk are untouched.
- Declined because: the builds that wrote tab asks went to a handful of testers, and a chat with one still open at an upgrade is unlikely enough not to carry a read path for; the lines stay on disk as written. Revisit if a report shows a chat that lost a card this way.
- Note: keep `tab` and `gone` readable (a read-only union member is enough) and close a `tab` ask found open.

### K. Clearing AI usage on one computer leaves its rows in every other computer's index

- Status: open
- Severity: Important. Privacy across the person's own computers: cleared history stays listed, and readable by `instrument activity`, on the others.
- Where: [store.ts:386](/packages/workspace/src/lib/activity/store.ts#L386), [store.ts:213](/packages/workspace/src/lib/activity/store.ts#L213).
- What: `clearOwnActivity` rewrites or removes this device's month files and deletes `WHERE device = ?` from this computer's `workspace.db`. Another computer catches up on a shrunken file by reading it again from the start with `INSERT OR IGNORE`, and no longer lists a removed one; neither path deletes the rows it indexed earlier, so they stay until that index is rebuilt.
- Note: when a file is shorter than what was read of it, or gone, delete that device's rows for that month before reading again.

### L. An unknown link's first 200 characters go into the log, and a too-long `new` link counts as unknown

- Status: open
- Severity: Important. Privacy, low: the log's tail goes with a report.
- Where: [outside-links.ts:287](/apps/studio/src/electron-main/lib/outside-links.ts#L287), [instrument-link.ts:182](/packages/shared/src/instrument-link.ts#L182), [instrument-link.ts:170](/packages/shared/src/instrument-link.ts#L170).
- What: the docblock keeps a `new` link's words and a file's path out of the log and makes one exception, a link the app does not know. But the parser also answers "unknown" for a known kind in a refused shape: `instrument://new?text=` with more words than the cap, or a `files` link with a path component after the host. Those log about 180 characters of the person's prompt or a path. Report redaction of addresses covers `http(s)` only.
- Note: log the text only when the host is not one the parser knows; a known kind in a bad shape logs its noun.

### M. Stopping the first step after a resume leaves a full copy of the conversation that nothing removes

- Status: open
- Severity: Important, narrowly. Conversation text outlives the chat, one copy per stop.
- Where: [language-model.ts:365](/packages/ai-gateway/src/lib/providers/claude-account/language-model.ts#L365), [language-model.ts:301](/packages/ai-gateway/src/lib/providers/claude-account/language-model.ts#L301), [resume-record.ts:280](/packages/ai-gateway/src/lib/providers/claude-account/resume-record.ts#L280).
- What: a resume or cold start begins a new Claude Code transcript at once, and the record is moved to it only after a finished step. Stop during that first step and the record still names the old transcript (or, after a cold start, nothing: the old record was removed first). The next request forks again, and the abandoned transcript has no record. The sweep walks records, so it never finds it, and deleting the chat does not either. `03b8ce326` notes the deleted-chat case under `Not-tested:`; this is the same gap reached by pressing Stop.
- Note: drop the session's own transcript on the stopped or failed path when no record names it, as `dropTranscript` already does for a superseded one.

### N. A tab restore that times out once is remembered as failed for the rest of the agent's connection

- Status: open
- Severity: Important, with the trigger unproven. A timeout stands in for an event and its result is cached.
- Where: [cdp-task-bridge.ts:446](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts#L446), [cdp-task-bridge.ts:184](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts#L184).
- What: `sessionOf` sets `entry.opening ??=` to the promise of bringing the tab's page back, which resolves `undefined` when the window does not answer the restore ask in two seconds. Nothing clears `opening`, and `attach` returns the existing entry, so every later command on that tab is refused as closed after the window has in fact restored it.
- Note: clear `opening` when it resolves to nothing, so the next command asks again. Not checked: whether the agent's browser tool reconnects on that error, which would hide it.

### O. Nit: one failed change in `chats archive|star|project` discards the lines for chats already changed

- Status: open
- Where: [chats.ts:277](/packages/workspace/src/lib/capabilities/chats.ts#L277), [chats.ts:104](/packages/workspace/src/lib/capabilities/chats.ts#L104).
- What: `eachChat` promises that a chat that fails "fails its own line and the rest go on", but a write that returns false throws inside it. With `chats archive a b c` and `b` failing, `a` is archived, `c` is never tried, and the agent reads one line about `b`.

### P. Nit: a branch that fails partway leaves a listed chat with part of the conversation

- Status: open
- Where: [branch-chat.ts:77](/packages/workspace/src/lib/chat/branch-chat.ts#L77).
- What: `ensureChat` registers the branch before its messages are appended one at a time, and a throw after that (a storage error, a `copyFile` code other than `ENOENT` or `EEXIST`, `setChatModel`) surfaces as an error with nothing removed. The source chat is untouched. Plus 2 similar in the same file: a branch is written from the parsed messages, so a part this build reads as `data-unknown` is copied as that and its original line is not; and a blob not yet on this computer is skipped silently.

### Q. Nit: find in chat counts text that is not shown

- Status: open
- Where: [use-find-highlights.ts:262](/apps/studio/src/client/components/document-viewers/use-find-highlights.ts#L262).
- What: `checkVisibility()` with no options passes `opacity: 0` and `visibility: hidden`, so each earlier reply's hover-only footer (model, duration, time) is counted and stepped to. `checkVisibility({ opacityProperty: true, visibilityProperty: true })` leaves them out.

### R. Nit: a hosted page with a long title in a non-Latin script cannot be kept

- Status: open
- Where: [hosted-page.ts:160](/apps/studio/src/electron-main/lib/hosted-page.ts#L160).
- What: the kept copy's name is cut at 100 UTF-16 units, which is past the 255-byte name limit of APFS and ext4 for about 84 or more CJK characters, and any error other than `EEXIST` ends the write rather than falling back to the page's id.

### S. Nit: Reopen Closed Tab pressed twice quickly brings back one tab

- Status: open
- Where: [app-tabs.ts:433](/apps/studio/src/client/components/window/app-tabs.ts#L433).
- What: both presses read the same render's `model.recentlyClosed`, pick the same tab, and the second finds it already gone.

## Confirmed tradeoffs

- The Claude account sweep and transcript removal cannot reach the person's own Claude Code folder: Studio always passes its own config folder, and removal targets only a transcript a schema-valid `instrument-sessions` record names. An unreadable record removes no transcript.
- Dropping effort from the session's shape costs one cold start per chat on upgrade, as `113561312` records under `Rejected:`.
- Outside links: `page` ids and tokens are pattern-bound, the fetch stays on the page's own host with same-origin redirects and a size cap, and the copy is written exclusively into the real Downloads folder, where a page reaches only itself by name and by real path. `file` and `files` links refuse traversal, UNC, backslash and drive-relative spellings, and the cap of 20 and the gate hold. A link inside a guest page still goes through the page's own open rules.
- The guest preload pins `contextIsolation` and `sandbox`, passes only strings between worlds, and a "capturing" report from an origin that was not granted is ignored. An agent's CDP input never counts as the person using the tab.
- The task CDP bridge answers or refuses `Target.*` itself, limits session-less commands to `Browser.*`, and checks local and extension addresses before a tab exists.
- The new chats, projects and activity commands: chat ids cannot traverse (`ChatIdSchema`, then `resolveChat`), the changing commands are chat-only with no script surface, and `instrument activity` is gated by `mayShareActions`.
- `resolve-workspace-file-path.ts` is reached only from the person's side; the branches that skip the agent's rules do so by design and say so.
- Bundled ffmpeg: archive and unpacked-tree hashes are pinned for six targets, after-pack verifies the packaged tree before signing, and the binaries sit outside the asar.
- Quit, reload and close: draft writes are synchronous on the same channel as the window's "done", `finishBeforeLeaving` is bounded and inside the quit deadline, and a watchdog reports a killed quit truthfully.
- Kept state and stores: a read error other than "not there" marks a file unreadable and it is never written over; the move to per-window files clears the old key only after the write lands; the key file's bytes survive a launch with no keyring.
- The freeze watchdog excludes sleep, ties its marker to the process, and leaves a live other instance's marker alone.
- New main RPC routes take ids, hrefs or schema-typed tabs, not paths, and window events are filtered by the caller's contents id. The renderer imports Electron as a type only.
- The chat list's row patches: revisions and sends move in one tick, a slow follower falls back to a snapshot, and a gap or another epoch forces a fresh one. No stale, vanished or duplicated row could be constructed.
- Asks: freshness is read against the answering device's clock, the first fresh answer in log order is taken, a closed ask yields no unused answers, and held questions are released at a session's end and at launch.
- The action log is capped per day and per folder, lives in the machine folder, and the note a chat gets carries only kinds, counts and minutes.
- Files operations act on paths captured at the gesture, never on list indexes, and a cut becomes a move only while the clipboard still holds the cut set.
- A developer capture's metadata (chat title, chat id, workspace name) goes with feedback unredacted and unlisted, but capturing is developer-mode only and the image shows the same things.
- `work-card.tsx` sets inner HTML only from spans that pass through `escapeHtml`.
- Sending feedback before gathering finishes re-gathers with the chat on by default and activity still opt-in; the comment owns the choice.

## Not covered

- A claimed defect that a task's fork point can be a chat step still being written, so the task's prefix differs between its first and later requests ([fork.ts:147](/packages/workspace/src/lib/capabilities/task/fork.ts#L147)). Not traced far enough to keep or drop: it turns on whether the step's parts are readable before the step ends.
- Whether `process.resourcesPath` exists in the bash worker thread of a packaged build, which `ffmpeg.ts` needs at import. Released builds run bash, so it almost certainly does; the smoke test would not catch it, since it runs ffmpeg from main.
- What Claude Code does when asked to resume a transcript that is gone (B and C rest on it failing or starting empty; either is a defect).
- In the main process: `agent-pointer.ts`'s in-page script, page thumbnails, guest sleep and surface, downloads list, most of `dispatch-command.ts` beyond its changed hunks, `rpc/person-actions.ts`, the menus' utilities, and the report redactor's internals.
- In the renderer: the tab strips and tab-carry changes after `76c920451`, `app-menu.tsx`, the project mark picker, `computer-page.tsx` past its file operations, the capture editor beyond a skim, Activity's requests and details views, settings and setup beyond storage, and the debug routes.
- In the workspace package: `next-message.ts`, `task-slices.ts`, `retitle.ts`, `window-tab.ts`, `driven-tabs.ts`, the permissions rules files, the layout and legacy migrations, the ffmpeg skill's text against the build, and the system prompt beyond the lines naming the new commands.
- In the transcript surface: developer notes, `flicker.ts`, the markdown editor beyond its value session, the task tab's wiring, and the server's `message.find`.
- `apps/studio/scripts/release-summary.ts`, `generate-dmg-background.ts`, and the failure-parsing half of `scripts/ci-report.ts`.
- All tests, and anything in the running app.
