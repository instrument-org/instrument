# Structure after the chat rework

Status: open. In progress. Items 1 to 7 and 10 to 13 are done, with these differences: the four live bugs and the dropped stop landed as fixes of their own; `Session` stays one schema rather than a union on `parentId`, since `parentId` already makes the distinction; the session registry stays keyed by chat, and an answer goes to the chat's own session by role; the status line reads the chat's record, `latest` while it works and a new `lastStep` at rest, with the last finished task still from the tasks list rather than from every row; `ChatInfo` is left as it is, since nothing on screen reads its two `updatedAt`s; `part.updated` stays as the stream that carries a part's content to the eval harness; and item 7 keeps two atoms, page hosts by group and tab facts by tab, because a page host draws whatever tab its group has up. Left: item 8 is unowned, since a session said it would take it up and nothing has landed; item 9 waits on the chat's activity popover, which replaces the work transcript it would split; items 14 and 15 were never taken up as such, though two of their pieces landed with other work: 14's `classifyInvocation` in `agent-browser.ts` (340019024) and 15's `browser-view/dev-hooks.ts` and `server-exception` removal (b4ab4d418). The evidence for what to do next is in three findings: [root causes of three weeks of fixes](../findings/root-causes-of-three-weeks-of-fixes.md), [where coding agents lose time](../findings/where-coding-agents-lose-time-in-this-repo.md) and [where the in-app agent fails](../findings/where-the-in-app-agent-fails.md). A record-kind type that would tell the window, a chat and a task apart was weighed and dropped: the about 20 fixes resolved against the wrong record all came during the chat and task rework, none in the 845 commits after it, and since the window lost its record folder (263d25c53) the chat readers and writers refuse the window's id outright, so a mix-up fails loudly instead of reading the wrong record.

The second pass of the kind [implicit-state-machines.md](implicit-state-machines.md) was: where state and data structures grew by accretion, now that the workspace-records refactor, one agent that works and forks ([decision](../decisions/2026-10-07-one-agent-that-forks.md)) and one chat, one database ([plan](one-chat-one-database.md)) have landed. The same rule of thumb applies: XState only where there are timed transitions, cancelation or an actor protocol; a pure reducer or transition function with node tests otherwise; long but coherent code is left alone.

Most of what the first pass found is a new kind of cruft this time. The reworks replaced the old shapes, but code written against the old model still asks questions the new one answers directly: "is this session the chat's?" is a lookup rather than a field, "which session is the chat's?" has two answers, and "is the chat working?" has two rules. A second cluster is maps keyed by the same id, kept in parallel because each feature added one.

Line numbers were read when this was written and the files move daily. Re-read before acting.

## What the first pass left

Every item of the Oct 3 plan landed as described: the wake overwrite fix (86594cd8f), the quit actor (aaf034642), the page edit actor, the browser entry phase (ac61eac40), tab reconciliation (`reconcile-guests.ts`), the slash menu as a ProseMirror plugin (e870cac6f), the omnibar reducer (646b193de), `nextStatus` for background processes (007a24b95), the updater's `verifying` phase (1dce07e3b), the guest navigation hook (4c7212f31) and the `useEffectEvent` sweep (8227d22dc). Every step of [window-tab-model.md](window-tab-model.md) landed except splitting `file-system.tsx`.

Two have regrown. Latest-value mirror refs are back in `browser-tabs.tsx:290-306`, `use-openers.ts:520-523`, `chat-window.tsx:264-276,303-321`, `compose-window.tsx:368-411` and `computer-page.tsx:1056-1059`. And `placementOf` exists but is bypassed (item 8).

## Order of work

1. Live bugs (small, each its own commit with a test).
2. One owner for the chat's session, and its role on the session.
3. One rule for a chat's state.
4. Stop carried on the event.
5. Change tracking keyed by session.
6. Atomic message writes.
7. Per-tab surface atom.
8. Opens through placement.
9. ChatStream split.
10. Session layout built once.
11. Loopback sign-in, once.
12. App connection transitions.
13. Task-era wording and names.
14. Medium tidies.
15. Small tidies.

Items 2 to 6 are in the workspace and build on each other loosely (2 makes 3 and 4 simpler); the rest are independent.

## 1. Live bugs

Each was confirmed by reading the code, not reproduced in the app.

- **A stop sent while a turn is starting is dropped.** `machines/session.ts`: `UpdatingSession`, `SavingMessageAndSpawningAgent`, `SpawningAgentOverStoredMessages` and `ProcessingQueuedMessages` all carry `agent.alive`, but only `Agent` handles `stop`; the root handler (368-370) logs "Agent not running". Callers check `isWorking` (the `agent.alive` tag), call `expectStop`, then send. The expectation stays in `wake.ts`'s map, so the turn's real finish is later read as stopped (inferred). Fix: handle `stop` in the pre-agent states (end the session without spawning), with a node test for a stop during `UpdatingSession`. Item 4 is the structural follow-up.
- **The chat pane's default disagrees.** `atoms/window.ts:256-266` says a group not named in `paneOpenByGroupAtom` has its pane open, and `route.tsx:152` and `app-window.tsx:534` read it with `?? true`. `isGroupShown` (`window/draft-context.ts:110-118`) requires `=== true`, so `send-context.ts:93,366`, `use-tab-in-view.ts:26` and `use-drafts.ts:148` treat a never-toggled chat's pane as closed. Every test passes the group explicitly. Fix: one `isPaneOpen(group, map)` holding the default, used by all four, with an empty-map test.
- **A failed trash leaves the chat refusing sessions.** `lib/trash-chat.ts:99-102` sends `removeChatBeingTrashed` only on the success path; the `finally` (106-108) unmarks storage only. A failed dispose or `trashItem` leaves the id in `chatsBeingTrashed` until restart. Fix: send it from the `finally`. Folding the store's `DELETING` set into `StoreEntry` as a `deleting` phase is the tidy beside it.
- **`chats.live.info` misses renames.** `rpc/routes/chat/index.ts:46-62` re-reads on `settings` and `removed`, but the title comes from the session row (`chat-info.ts:83-90`) since f26a6596c. Latent: the renderer reads only `id`, `modelURI` and `reasoningEffort` from it. Fix with item 5's shrink of `ChatInfo`, or add `session` to the filter.
- **Back at a tile's start differs by host** (inferred). The docked chat's tiles open with `isOpened: true` (`chat-window.tsx:344`), the in-tab chat's do not (`route.tsx:189,204`), so back at the start closes the tile in one and not the other. Folds into item 8.

## 2. One owner for the chat's session, and its role on the session

`lib/record-folders.ts`, `lib/chat/latest-session.ts:63-89`, `lib/chat/children.ts:104-128`, `lib/chat/wake.ts:452-469`, `rpc/routes/message.ts:118-137`, `machines/session.ts:168-185`, `schemas/session/index.ts:7-97`.

Which session is the chat's has two answers: `settings.chatSessionId` through the index (`sessionOfChat`), and `latestSessionId`, the newest parentless row in `chat.db`. Four places can create that row: `ensureChat` writes only settings; `message.create` calls `createSession` (a full `saveSession`, fresh title and `createdAt`) whenever `sessionId` is omitted; the session machine's `updateSession` creates it if missing; and `wakeWith` calls `latestOrNewSessionId` before looking at the `chatSessionId` it was handed. Then `chatConversation` (which returns the `ChatId` it was given, or undefined) and `isTaskSession` decide chat or task by comparing with `sessionOfChat` rather than reading `parentId`, at 16 call sites, including on every message and step in both machines (`session.ts:325`, `agent.ts:678`) and in every file tool (`bash.ts:173`, `read-file.ts:504`, `write-file.ts:56`, `edit-file.ts:780`, `connect-app.ts:70`, `agent-browser.ts:1104`).

Shape: chat creation writes the row; `sessionOfChat` is the only answer; `latestSessionId`, `latestOrNewSessionId`, the `createSession` branch and the uncalled `newSessionId` input go. `Session.Schema` (five fields documented "absent on the chat's own session", six chat-only) becomes a union on `parentId`. A `sessionRole: "chat" | "task"` is computed once and passed to the session and agent machines as input and on the tool-execute context. In shell commands, `create-bash-env.ts:540`'s `chat?: { id }` (always equal to `chatId`) becomes that role.

Size M, value high: it removes a class of "stray top-level session reads as a task" bugs, and items 3, 4 and 10 read the role.

## 3. One rule for a chat's state

`lib/chat/chats.ts:158-164` (`chatIsWorking`), `466-478` (`chatFor`), `907-927`; `window/chat-status-line.tsx:49-67,158-211`; `window/chat-row.tsx:553,659-667`.

`chatFor` combines the session tags, the chat's own unanswered ask, `task.waiting`, `hasPendingWake` (the wake debounce) and `turnIsStarting` (a 30 s `TURN_START_GRACE_MS` covering the gap between a message being written and its agent starting). `chatIsWorking` ignores the last three and feeds `startChatUnreadOnSettle` and `retitle.ts:234`, so a turn ending while a task's wake sits in the 1.5 s debounce marks the chat unread and retitles it before waking it (inferred). On the client, the header recomputes the step from `message.live.list` with the same `turnStart`/`latestStepIn` the server digest uses, plus an `isStarting` guess from `chat.state` and the `agent.running` tag, while the row reads the server's `chat.latest`. The status words themselves are defined four times (`Session.status`, `ChatTaskSchema.status`, `ChildTaskSchema.standing.kind`, `TaskStandingKind`).

Shape: one pure `chatState({ ownAlive, ownAsk, newestTurn, tasks, pendingWake, failed, now })` returning `working | waiting | failed | idle`, with a table test, used by both server callers. The server returns the whole status line (text and tone) on `Chat`; `statusLine` and its test move to the workspace and the header drops its message subscription. One exported status enum. Task `status` on the session row is written on every send and finish and read nowhere (`children.ts:135-153`, `wake.ts:285-288`, `delivery.ts:72`, `fork.ts:216`; readers use `taskStanding`), so it goes; `stoppedBy` stays. The `ownStep` field [chat-status-line-and-loading-states.md](chat-status-line-and-loading-states.md) proposed is superseded by this, and that plan otherwise landed (dc7a43446), so it moves to `completed/`.

Size M, value high.

## 4. Stop carried on the event

`lib/chat/wake.ts:89-116,283-294`, `rpc/routes/session.ts:129-152`, `shell-commands/task/stop.ts:141-148`, `machines/session.ts:405-412,445-497,506-509`.

One stop is spread over the machine's `stop` event (`StopReason`), a module map in `wake.ts` (`ExpectedStop { by, wakesChat }` by session) and `stoppedBy` on the row (d4d1d30be, 2e31ae013). Shape: `{ by, wakesChat }` rides on `stop` into the session's context and out on `session.done`; wake reads it from the payload and its map goes.

Beside it, the session machine's `UsingReadOnlyTools`/`UsingNonReadOnlyTools` × `Running`/`Paused` tree, `markUsedNonReadOnlyTools`, `usedNonReadOnlyTools` on `session.done` and the `agent.paused`/`agent.using-non-read-only-tools` tags have no consumer (only `agent.alive` and `agent.running` are read; `instrument.ts:163` works out write use again). Collapse to `Running | Stopping | AgentDone` and drop `agent.usingTool` (its other reader is a log line in `packages/workspace/scripts/run-workspace.ts:161`).

And the workspace machine's registry: sessions are `Map<ChatId, SessionActorRef[]>` found by scanning snapshots (`machines/workspace/index.ts:141-152,184-203,285-345`). Shape: `Map<SessionId, { chatId, ref }>`; `prepareToTrashChat`'s one-element array and counter go.

Size M, value med-high.

## 5. Change tracking keyed by session

`lib/store-generation.ts:9-63`, `lib/session-store-storage.ts:219-243`, `lib/workspace-index.ts:84-125`, `lib/chat/chats.ts:329,542-557`, `lib/chat/standing.ts:27`, `lib/store.ts:123-133`, `changed-message-batches.ts`, `record-changes.ts:66-121`.

Since b834385c7 every task writes into the chat's `chat.db`, but the store generation and the cross-launch stamp (file size and mtime) are per database. One task streaming invalidates the chat digest and every sibling's `task_standings` and `task_hosts` rows, and each recompute of a task reads its parent's transcript too. The store also publishes `message.updated` and `part.updated` by hand beside the write layer's `record.changed { messages }`, and the two coalescing iterators are the same code written twice.

Shape: `record.changed` carries `sessionId` and `messageId`, parsed in `storeKeyChange`; the generation is keyed by chat and session; `changedMessageBatches` becomes a filter over `recordChanges`; the hand publishes go; the `task_*` index tables get chat-era names under a bumped `INDEX_VERSION`. This is the first half of [incremental-live-transcript-updates.md](incremental-live-transcript-updates.md).

`ChatInfo` shrinks in the same pass (`lib/chat-info.ts:61-91,132-147`): `updatedAt` means `settings.lastActivityAt` there and the session's activity on the `Chat` row, `createdAt` is kept in three places, and the renderer reads three fields. It becomes the settings view, `getChatInfos` (evals and scripts) moves to `listChats`, and `lastActivityAt`, written on every send and read by no list, goes unless something needs it.

Size M, value high (the recompute cost is inferred, not measured; measure before and after).

## 6. Atomic message writes

`rpc/routes/message.ts:254-292` (retry with `sleep(50)` twice, then reload), `store.ts:90-95,148-154` (skip messages missing mid-write), `store.ts:497-508` (`publish: false` ordering).

A message is 1+N unstorage rows written without a transaction, and three places work around the gaps. A chat is now one SQLite file and `store-table.ts:30-55` already runs BEGIN/COMMIT for migrations. Shape: a transactional `saveMessageWithParts` on the db0 instance; the three workarounds go. [conversation-storage.md](conversation-storage.md) phases 0 to 2 cover this but describe per-task `task.db`; rewrite that plan's premises rather than following it as written.

Size M, value med-high.

## 7. Per-tab surface atom

`atoms/window.ts:43,52,73,474`, `window/shell-context.ts:27`, `window/on-screen.ts:22-77`, `window/files-screen.tsx:395-414`, `window/computer-page.tsx:974-990`, `window/use-compose.ts:36-53,118-135`, `window/compose-layer.tsx:283`, `window/compose-window.tsx:512-533`.

Facts about one tab sit in about nine maps: `screenViewsAtom`, `walkedFoldersAtom` and `findersByTabAtom` by tab id, written by two copies of one effect in `on-screen.ts` and a third in `files-screen.tsx`, all from one `FolderOnScreen` that `computer-page.tsx` reports up through an eslint-disabled effect; `pageSlotsAtom` by group and `pageSlotByTabAtom` by app tab; and four maps in `useCompose` by group, fed by `GroupItem.onPageHost` → `ComposeWindow` state → effect → `setHost`, cleared together in `forget`. `compose-window.tsx` reads `screenViewsAtom[up.id]` and reports it back up as `viewsById`. Grown by 205cd5017, 7994ed291, a2b6b403e, 0da0e9c3c.

Shape: one `tabSurfaceAtom` by tab id holding `{ view, walked, finder, slot }`, written by one `useTabSurface` hook. `BrowserTabs` reads slots from it, which retires the `ComposeHost` prop chain and `forget`.

Size M-L, value high.

## 8. Opens through placement

`window/chat-window.tsx:342-365`, `compose-window.tsx:450-500,560-578`, `routes/_app/route.tsx:186-210`, `group-item.tsx:166-172,251-255,281-301`, `app-window.tsx:626-633`, `use-openers.ts:411-424`, `tab-model.ts:192-201`, `browser-tabs.tsx:566-580`, `child-tasks.tsx:291-313`.

`placementOf` landed, but each host has its own openers, window commands call `appTabs.open` directly, `actOnTab`'s open skips `screenPlacementOf`, "replace a waiting group's home tab" is written in both `tab-model.ts` and `browser-tabs.tsx`, and `child-tasks.tsx` copies `hrefOfNamedPath`. The `isOpened` mismatch in item 1 is one result. Shape: a host-aware `groupPlacementOf`, one `openInGroup` on `useWindowTabs`, one named-path resolver. All three build on `matchScreen(href)` and the `Screen` union in `window/window-href.ts` (87862f84d), which every address classifier already goes through.

Related, in the same files: site-group lifetime is reconciled across the app-tab and window-tab models by two effects (`app-window.tsx:345-401` copies groups into `putAwaySitesAtom`, `route.tsx:524-542` restores them). Closing an app tab can stash its site group on the `recentlyClosed` entry and reopening restore it, leaving a pure `siteGroupsLeaving(model, tabs)`.

Size M, value med.

## 9. ChatStream split

`components/chat-stream.tsx:271-942,1275-1320`, `components/chat-stream-render-part.tsx:85-235`.

`presentation` appears 25 times across the two files: the chat view (bubbles, runs, followed tails, repeated-line dedupe, held drafts, typing dots) and the work transcript (groups, stand-ins, wordmark, footer, Planning row) are one `buildChatElements` loop. The chat view still runs `readTurnOpenings` (300), `lastAssistantMessageHasVisibleParts` (290), `partsById` (405) and the `useTaskBackgroundProcesses` live query (396), whose results only non-chat paths read: three walks of every part per token and a subscription for nothing. The work view's only callers are `window/child-tasks.tsx:103` and the debug transcript.

Shape: `ChatConversation` and `WorkTranscript` over a shared pure `deriveTurns(messages)` with node tests. This replaces [chat-stream-turn-model-refactor.md](chat-stream-turn-model-refactor.md), whose collapsing already shipped in `transcript-layout.ts`; rewrite that plan around the split.

Beside it in `task/chat.tsx`: follow is an implicit machine (`autoScroll = isAgentAlive || isFollowingSubmit || isSettlingTurn`, a 5 s submit timeout, a 1 s settle timeout in `use-turn-settle-window.ts`, a `scrollToEndSignal` counter) that wants one `useTranscriptFollow` over a pure reducer with a timer port. And the first send from a draft draws through `sentWords` → `sentPrompt` → `SentPrompt` (191-226, 554-580), a fake part plus `TypingRow` outside `ChatStream`, while later sends use `PendingPrompt`. `SentPrompt` shows typing dots before a reply exists, against dc7a43446's `Commits-to`. Seed `pending` from `sentWords` and delete `SentPrompt`.

Size M-L, value high.

## 10. Session layout built once

Done. After real host paths there were still five builders over `buildWorkspaceFsLayout`, three of them drift:

- The shell (`shellLayout` in `create-bash-env.ts`) and the three file tools inline: the chat's apps for the chat's session, `chatReach` with the session as asker. These agreed.
- Image generation: the same without the apps, so a chat could not read a source image in an app it was authoring.
- `taskFsLayout`: no apps and no asker, used by `agent-browser`, the CDP bridge's local-file gate, the browser status part, the chat's spelling of a task's tab, and the renderer's path resolution. A chat writing an app's page in its shell could not open it in its browser, since the workspace root is hidden and only the apps mount allows it, and a refused page raised no card where `cat` would.
- `computer.ts` (the person's file browser): built a layout only to read its folder list back, with `chatDir` where the rest use `workDir` (the same folder today).

Now `lib/session-layout.ts` owns it: `sessionLayout({ chatId, sessionId?, partId? })` for every caller, the role read from the session (the chat's own when none is given), and `roleLayout` for the shell, which reads its folders on the main thread and its rules where it runs. `agent-browser` takes the shell's layout rather than building one, and `computer.ts` maps its folders directly. `session-layout.test.ts` is the table of what each role reaches. Load-skill, uv and background processes only ever used `workDir`, which was never in question.

## 11. Loopback sign-in, once

`electron-main/auth/client.ts:19-25,60-139`, `auth/server.ts:173-238,244-328`, `lib/chatgpt-account.ts:101-110,442-517`, `lib/openrouter-connect.ts:26-60,77-121,177-180`.

ChatGPT and OpenRouter each keep a near-identical pending sign-in (`deliver`, `supersede`, `state`, `promise`, a timeout, their own `noop` and `base64url`); OpenRouter was added by copying (a084e9385). Google keeps its pending state in an exported mutable `store` and reaches the waiting promise through the `auth.sign-in-outcome` publisher event, whose only subscriber is in the same process. App sign-in parses, cancels, records and announces inline in the callback route. `auth/server.ts` has 21 commits since Oct 3.

Shape: one `createLoopbackFlow<T>({ timeoutMs, run })` returning `{ receive(params), supersede() }`; each provider exposes `receiveXCallback(params)`; the server only renders pages; `auth.sign-in-outcome` goes.

The Claude account's state (`lib/claude-account.ts:84-94,131-170,182-193,291-365,411-463`) is the same problem in another form: module variables for status, install, pending sign-in, refresh, a `codePasted` WeakSet, `replacing` and `installing`, with install progress stored twice. Build the status from the CLI reading, install progress and sign-in when read; sign-in (waiting, code pasted, replaced, timed out, canceled) becomes a small XState actor like the ChatGPT grant (d325c9555).

Size M, value high.

## 12. App connection transitions

`electron-main/rpc/routes/apps.ts:165-243,479-504,592-601,685-708,763-769,848-851`, `auth/server.ts:267-268,294-301`.

An app's connection moves between untested, needs approval, needs key, needs sign-in, connected, stale, failed and declined, and each move is a hand-written `recordConnection` plus `appChanged` in route code (about ten sites; `auth/server.ts` repeats `decline()` word for word). `standing` is worked out inline in `list`, and `AppListItemSchema` is a flat bag of type-dependent optionals with `authKind: z.string()`. `apps.ts` is 871 lines with 23 commits since Oct 3.

Shape: `lib/app-connection.ts` with `settleConnection(slug, outcome)` and a pure, tested `standingOf(connection, manifestHash)`; the list item becomes a union on `type`.

Size M, value med-high.

## 13. Task-era wording and names

What the agent reads contradicts itself: 24 lines in 13 files under `shell-commands/`, `tools/` and `agents/` say "task folder", "task root" or "per-task virtualenv" (`pip.ts:17,26`, `python.ts:50`, `uv.ts:19`, `utils.ts:386`, `pnpm.ts:189`, `load-skill.ts:268`, `js-exec.ts:291`), while the system prompt (`agents/instrument.ts:290`) says the folder is the conversation's and every task shares it, and `task` the command means a child session. The virtualenv is per chat (`ensure-task-venv.ts:28`).

Shape: first, the tool copy says the chat's folder and virtualenv (small, but it touches cached prompt text, so run evals). Then one mechanical rename of about 21 identifiers that take a `ChatId` or a chat path (`ensureTaskVenv*`, `execaNodeForTask`, `resolvePathWithinTaskDir`, `redactTaskDir`, `getTaskActivity`, `normalizeTaskFilePath`, `isTaskFileHref`, `showTaskFolder`, `utils.taskFolderPath`, `MarkdownTaskContext`, `useShowTaskFile`, `useTaskActivity`, `TaskChat`, `useTaskSession`/`TaskSessionProvider`, `chatGroupAtom`, browser-view's `unblockedTasks` and `contentBlocking → { task, workspace }`), plus the record API taking a `ChatDir` and parsing the id back out of `basename` (`lib/chat-record.ts:133-141`) when every caller passes `chatDir(chatId)`, and the nine `const chatId = id`. The `/task` mount is left to real-host-paths.

Size M, value high for the copy, med for the rename.

## 14. Medium tidies

Each worth doing when someone is in the file.

- **Finder address sync** (`window/computer-page.tsx:341-376,855-894`): three refs (`written`, `arrived`, `lastOnScreen`), an `openings` counter that doubles as a remount key, a `settled` flag and a `setTimeout` over a one-render race (846730374, dd6975361, 74c2cff8d). A pure `finderAddress(state, event)` with node tests. The Oct 3 plan scoped the Finder out, so nobody owns this yet.
- **Split `file-system.tsx`** (6658 lines; `FileSystem` 1624-3258 has 25 `useState`, 21 `useRef`, 16 effects; the views are already separate functions at 4471, 4972, 5465 and 6264): move the views to files, pull the rename and gesture interpreters into one hook, drop the 45 hand-written `useCallback`/`useMemo`. `ComputerPage` (1584 lines in one function) is the second candidate.
- **agent-browser invocation** (`shell-commands/agent-browser.ts:622-988`): one 370-line closure where `isInfoOnly`, `isExternal`, `browserFreeRead`, `browser.hasNoWindow`, `let drivesHeldTabs` and `let pluginRegistry` are set in an if/else chain and re-derived later. A pure `classifyInvocation(args, config)` returning `info | external | read | headless | heldTabs` and a per-kind plan, with table tests.
- **Native command table** (`ffmpeg.ts`, `ffprobe.ts`, `shortcuts.ts`, `osascript.ts`, `uv.ts`, `pip.ts`, `python.ts`, `node.ts`, `git.ts`): each hand-assembles path-arg detection, refusal, bridging, env, run and output rewriting. `defineNativeCommand({ name, binary, argRoles, bridgeCode?, mapOutput? })`. With real-host-paths step 2.
- **`app new`** (`shell-commands/app.ts:763-952`, 7 commits): a pure `manifestFromFlags` returning a manifest or a refusal by type, and a pure `nextStep`, so `runNew` keeps only I/O.
- **Background-process registry** (`background-processes.ts:200-213,316-400`): `Map<session, Map<id, record>>` with a per-chat counter; hand-over rewrites `chatId` to the same value. `Map<ChatId, { nextId, records }>` with an `owner: SessionId` field.
- **Joining a running turn** (`session.ts:297-364`, `agent.ts:364-368,434-445,883-908`): `queuedMessages` + `savedMessageIds` in the session and `steeringMessages` + `savedSteerIds` in the agent, reconciled by `agent.consumedSteer` (a42003d46, 03a2862a8, 46903588a). A steer after `MaybeSteering` may run as its own turn still carrying the mid-turn note (inferred). One queue of `{ message, saved }` with the note decided at enqueue.
- **App window asks** (`windows/app-window.ts:49-69,114-126,187-233,296-393`): `pendingAsks`, `isTakingAsks`, `isWarming`, `painted`, `showsMaximized` (7a03bbb95, b7082731e, b79e98d8e, a5fca6f59). A `phase` union with a pure `routeAsk(phase, ask)`. "Last window closed, so quit" has three rules (Electron's, the app window's, onboarding's); one `quitIfNothingVisible()`.
- **Settings deep links** (`atoms/settings-modal.ts:14-29`): five one-shot fields each consumed by its own render-phase "seen" copy, and two scroll-to-row mechanisms. One `target` union plus a per-open nonce and a `useSettingsRequest(kind)` hook.
- **`newMessage`** (`lib/new-message.ts:33-323`): seven hand-built metadata blocks, three `isChat` gates, side effects in a builder; "save, resolve the model, send `addMessage`" is written four times. A `send` port and role-chosen part producers.
- **Path and file-URL helpers**: file URL to host path three times with three copies of the drive-letter check; two different functions named `hostPathOfComputerFileUrl`; `fileUrlOf` and `fileUrlOfHostPath`; private `displayHostPath`/`expandHomePath` in `computer.ts:455,469` shadowing `shared/folder-paths.ts`; `HostPathSchema` three times in Studio main beside the workspace's `AbsolutePathSchema`. One host-path module in shared.
- **Two matchers for one search**: the omnibar's `matchNames`/`matchPages` and the command menu's `nameMatch`/`fuzzyMatch` rank the same chat differently. Move both into `omnibar-match.ts`.
- **Release channel** worked out three ways (`lib/update.ts:184-201`, `lib/notices.ts:36-43`, `rpc/routes/releases.ts:97-102`); an Intel Mac may read notices from another channel than it updates from (inferred). One `currentReleaseChannel()`.

## 15. Small tidies

- Dead code: `debug.browser-view-manager.updated` and all of `browser-view/dev-hooks.ts` (no subscriber since 156580ed3), `server-exception` (never published), `commandPublisher`/`app.command` (carries only zoom, which `window.command` also carries), `updates.trigger-check` (main to main), `normalizeWindowTabs`'s pre-v9 fields (`tab-model.ts:28-82`), `RETIRED_GROUPS` (`app-window.tsx:125-130`), `RunningTask.chat`, `newMessage`'s unused `intent`, the `isChatId` guard on a typed `ChatId` in `agent-browser.ts:632-640`, the unreachable `sessionId` guard in `task/fork.ts:62-65`, the unused `session.list` route, and `model-picker.tsx:915`'s `showNewProviderDialog: false`.
- Renderers for parts nothing writes (`data-fileChanges`, `data-chatContext`, `chat-stream-data-parts.tsx:189-258`): convert them in the 1.x migration, then delete.
- `browser-view/entry.ts`: `attach.settled` repeats the phase; `destroyEntry` and `handleDetach` nearly duplicate and the `destroyed` and `render-process-gone` events pick different ones; `bindHost`'s comment promises one host per window and `hostOf(targetId)` ignores its target (a73917f45); thumbnails reach guests by `webContents.fromId` rather than the registry.
- Two live routes hand-roll a `{ revision }` ping (`skill.ts:237`, `chat/background-processes.ts:117`), costing a refetch round trip each; make them `liveRead`.
- `create-bash-env.ts:723-782`: command objects and their names are two hand-kept arrays, `customCommandDefs()` is called twice, the `which` set and `MAIN_THREAD_COMMANDS` are separate lists. Derive them from the definitions.
- `PromptInput` draws `ComposerAddMenu`, `ModelPicker`, the context ring and Send twice, once per layout; `ModelPicker` is half controlled and closes twice. The composer's `isLoading` lock and the refocus workaround from d9a18c120 protect nothing since 5832bbb59 (confirm the server orders concurrent `createMessage` first).
- `rpc/routes/utils.ts` (696 lines) holds window controls and `approveWindowClose` beside `routes/window.ts`; move them.
- Draft teardown lives in three places (`app-window.tsx:324-343`, `use-drafts.ts:205-229`); one `forgetDraft(id)`.
- Bookmarks' `BookmarkNameField` can adopt `useInlineRename`; rename is otherwise down to the hook and the Finder's `renameStep`, which stays separate.
- Beta `chats/<id>/tasks/` folders are special-cased in `workspace-fs-layout.ts:700-712`, `resolve-agent-path.ts:263` and `rg.ts:228`; a layout step moving them into `.pre-chats/` drops all three. `isProjectFolder` is defined twice in the migrations.
- Shared helpers: `errorMessage(unknown)` for about 80 inline `instanceof Error` ternaries, one `isRecord` (eight copies), `pathExists` over four private `exists()`, `formatBytes` over five local formatters, one `delay(ms, signal)`.
- Split `settings/activity-section.tsx` (1407 lines) and the prompt text out of `memory-section.tsx` (1097).
- `schemas/session/message.ts` holds about 370 lines of `toUIMessages`/`toModelMessages` and imports 15 `lib/*-model-text` modules; move that to `lib/`. `lib/chat/chats.ts` (927 lines) splits into marks, a pure digest and the row.
- Stale comments: `create-app-updater.ts:454-456` (the `installing` probe went in aaf034642) and `lib/update.ts`'s "set on the machine preferences store manually" (the picker landed in 31a4b9a2b).

## Open questions

- **Result library.** typescript-result is the chosen library, but `packages/workspace/AGENTS.md:10` tells code that composes with `Store`, tools or shell commands to stay on neverthrow, which is nearly all of the package: 60 files and about 309 call sites, zero migrated. Either migrate bottom-up starting with `Store` (item 6 is a natural first slice) or record that the workspace stays on neverthrow.
- **radashi.** `AGENTS.md` says use radashi; [radashi-to-es-toolkit-migration.md](radashi-to-es-toolkit-migration.md) retires it. 110 files import radashi, none import es-toolkit. One of the two should change.

## Looked at and left alone

- `wake.ts` beyond item 4: the Oct 3 fix held and the file grew 21 lines; its per-task reducer is still not due.
- `agent.ts`: XState is earned (chunk timeout, retry backoff, cancelation, tool-call children).
- `llm-request.ts`: parallel maps by `toolCallId` in one closure want a pure `applyStreamPart`, but churn there is features, not race fixes, and it is tested. Do it when next in the file.
- `instrument.ts`, `chat-browser.ts`, `fork.ts`, `computer.ts`: mostly prompt, a real liveness machine, small, and feature churn respectively.
- `StoreEntry` phases, `chat-record.ts`'s raw-field-preserving writes, `store-migrations.ts`, `migrate-legacy-tasks.ts`, `record-folders.ts`: explicit and coherent.
- `defineSubcommands`, the `task/` split, output rewriting through one call per command, folder grants through `grantFolder`, `bash.ts`'s `toModelOutput`, the bash worker and `jobs`/`fg`/`kill`.
- `tab-model.ts`, `window-tabs.ts`, `placement.ts`, `tab-steps.ts`, `group-item.tsx`, `omnibar.tsx`, `command-menu.tsx`'s close timer, `use-drafts.ts`'s arrival timer, and session-prefix chat links in `use-openers.ts` (stored transcripts need them).
- `index.ts`, `create-workspace-actor.ts`, `chatgpt-grant.ts`, `create-app-updater.ts`'s three install fields, `mac-native.ts`, `guest-registry.ts`, the notice and catalog pollers.
- `dev-panel.tsx`, the settings modal's search, `general-section.tsx`, `model-picker.tsx`'s panel, the notifications bell, `TailFirst`.
- Branded ids (one source), cross-package type names (derived, not copied), knip (clean by default), feature flags, retry loops (each context-specific), ai-gateway model identity (one owner, imported), and the 1.x migration code (kept on purpose).
- `doc-sync.ts` and `data-grid.tsx`: large but stable.
