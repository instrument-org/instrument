# Plan: chat records as append-only logs, one per session per device

Status: approved to build on branch `chat-records`, stacked on `workspace-layout`; phases 1 and 2 built (`packages/workspace/src/lib/records/`, not wired into the app), phase 3 next. Nothing merges to main until it has been reviewed.

A chat's record today is a SQLite file, `chat.db`, inside the workspace's `.instrument/` folder, which the person may put in iCloud Drive, Dropbox or OneDrive. A sync engine copies files whole and can upload a database mid-transaction, and today's store rewrites nearly every row after its first write (a streaming part is saved whole every 100 ms). This plan makes the record append-only JSONL that a sync engine can carry safely, keeps one rebuildable SQLite database on each computer, and rebuilds the read side around what the window draws today.

Supersedes the backing-store phases of [conversation-storage.md](conversation-storage.md) and [long-lived-conversation-storage.md](long-lived-conversation-storage.md), and folds in [tool-result-media-dedup.md](tool-result-media-dedup.md) with blobs per chat instead of per workspace. The views replace the route [incremental-live-transcript-updates.md](incremental-live-transcript-updates.md) reworks. Attachments, drafts and the visible folders are in [instrument-folder.md](instrument-folder.md), which supersedes [chat-attachments-by-reference.md](chat-attachments-by-reference.md). Research behind the choices: [syncing-a-data-folder-through-file-sync.md](../../findings/syncing-a-data-folder-through-file-sync.md).

## Decisions

- The record is JSONL in the chat's record folder `.instrument/chats/<id>/`, which travels with the workspace. Per-chat SQLite goes away.
- One log file per session per device, and one marks file per device. Every file has exactly one writer: the device its name carries.
- A change is a new line, never an edit. The newest snapshot of a message or part wins.
- Only settled records are written. Streaming deltas are never persisted, and there is no journal for them; a crash mid-reply loses the unfinished part, which then reads as interrupted.
- Live data (a tool call's `activity` while its input streams, the task page's streaming text, permission asks) stays in memory and goes to the window only.
- Images and every other binary a tool returns become blobs named by their hash in the chat's `blobs/`, which travel with the chat.
- Big command output stays on this computer, in `work/<chat>/.tool-output/`, as today; the log keeps its head, tail and path.
- One SQLite database per workspace on this computer, `workspace.db`: the index, the activity log and the window's own browser visits.
- No lease between devices in v1. On one computer, `open.pid` keeps a second app process out.
- No rolling to a new log at a size limit in v1. The reader accepts more than one file per session and device, because recovery starts a second one.
- The device id is bound to the hardware, so a restored backup or a Migration Assistant copy never appends to its twin's logs.
- No general query API ported from `Store` (`getMessagesWithParts` and friends). Each open chat is folded once and read through six views named for what draws them.
- The agent's history search goes through the app (fold and scan now, full-text search in the index later), never ripgrep over the folder, which would download every evicted log.
- Migration covers 1.x and beta.61 onward, with no reverse path. The nested task stores betas wrote before tasks became sessions stay set aside, as [one-chat-one-database.md](../completed/one-chat-one-database.md) decided.
- Testing order: local correctness first and most; syncing between devices last.

## Words

| Word | Means |
|---|---|
| record | one JSON line in a log |
| log | `<session>.<device>.jsonl`, one session's records written by one device |
| marks | `marks.<device>.jsonl`, the person's title, star, archive, unread, topics and Stop for every session in the chat, from one device |
| fold | reading every log and marks file of a chat into sessions, messages and parts |
| view | a read shaped for one screen or caller, made from the fold or the index |
| device id | `dev_` plus 8 Crockford base32 characters, one per install per machine |

## On disk

```
<workspace>/.instrument/chats/<chat id>/        travels with the workspace
  <session id>.<device id>.jsonl                one per session per device
  <session id>.<device id>.2.jsonl              after this device read newer records from another device's log, or recovery refused the first
  marks.<device id>.jsonl                       the person's marks, from this device
  blobs/sha256-<hex>.<ext>                       written once through a temp name
  attachments/                                  as today, until instrument-folder.md moves it out
  settings.json                                 as today
  handoff-notes.md                              as today, until instrument-folder.md moves it out

<machine>/workspaces-data/<local id>/           this computer only
  workspace.db                                  index, activity log, window browser visits
  set-aside/chat-db/<chat id>.db                converted chat.db files
  work/<chat id>/.tool-output/                  big command output, as today
<machine>/machine-state.json                    adds deviceId and hardwareId
```

The folder holds no SQLite, no lock file and no file anyone rewrites in place. `settings.json` and `handoff-notes.md` keep their single-writer rules from today and are outside this format.

## The device id

- Stored in `machine-state.json` as `deviceId` with `hardwareId`, a SHA-256 of the machine's own id. The hash never goes into the workspace folder.
- The machine's id: macOS `IOPlatformUUID` (from `ioreg -rd1 -c IOPlatformExpertDevice`), Windows `MachineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography`), Linux `/etc/machine-id` (falling back to `/var/lib/dbus/machine-id`).
- At launch, a missing `deviceId` or a `hardwareId` that does not match the machine makes a new random device id. Same hardware keeps its id across reinstalls of the app's data only if `machine-state.json` survives; a fresh id is always safe, since it only means a new file.
- If the machine's id cannot be read, the app keeps the stored device id and logs why.

## Records

Every line is one JSON object, keys in this order so a reader can skip by prefix: `{"t", "seq", "at", ...}`. `seq` counts up from 0 within the file. `at` is an ISO date. Dates elsewhere are ISO strings that the existing Zod schemas turn back into `Date`s; superjson goes away, and an explicit `undefined` is simply absent.

| `t` | Fields after the envelope | Fold rule | Replaces |
|---|---|---|---|
| `session` | `format`, `id`, `chat`, `createdAt`, `device`, `app`; a task adds `parent`, `forkedAt`, `handle`, `title`; every log after the first adds `continues: {<log stem>: <seq>}`, how far its writer had read each earlier log of the session (a stem is `dev_X` or `dev_X.2`) | First line of every log. A file whose first line is not a header is refused, not repaired. | the immutable half of `sessions:<s>` |
| `message` | `message: {id, role, metadata}`, today's `SessionMessage` | Newest snapshot per id wins. Messages ordered by id (ULID), as today. | `messages:<s>:<m>` |
| `part` | `part`, today's part with `base64Data` swapped for `blob`, `mediaType`, `bytes` | Newest snapshot per part id wins. Parts ordered by id under their message. | `parts:<s>:<m>:<p>` |
| `retract` | `messages: [ids]`, `why` | Drops those messages and their parts from the fold. Ids are never reused. | `removeMessage` |
| `rollover` | `after`, `usableTokens` | Newest wins; same meaning as `rolledOverAfterMessageId` today. | two session fields |
| `stopped` | `by: user, chat or app` | Applies until a message that starts a turn follows it. | `stoppedBy` |
| `told` | `what: folders, apps, memory, processes or browser`, `value` | Newest per `what` wins; `null` clears. | the five baseline keys and `browser-state:<s>` |
| `mark` (marks file only, no header) | `session`, `field`, `value`, `device`. Values: title `{text, settled}`; starred and archived a boolean; unread `{byUser}` or `null`; topics an array of topic ids; stoppedAt an ISO date | Across every device's marks file, newest `at` per (session, field) wins, ties going to the larger device id. An unsettled title never beats a settled one. | the mark half of `sessions:<s>` |

A session's history is its own logs; a task's is its parent's fold up to `forkedAt` (by message id, never by byte offset), then its own logs.

Records from several logs of one session are ordered by place: the sum of the header's `continues` plus the record's own `seq`, ties going to `at`, then the log, then a hash of the line. That holds because a device that has read another device's newer records starts its next log with a header saying so, rather than appending to the old one. Two logs that each hold records past what the other's writer had read of that session are a fork: the fold keeps both continuations and flags the session. Its display is outside v1. A record is known by its log, place, `seq` and line hash, so an identical copy from a sync conflict folds once and a copy whose bytes differ keeps both.

Dates inside `told` values and tool outputs come back as ISO strings; their readers coerce them.

## Writing

- Each log is opened `O_APPEND` and each record is one `write()` of the whole line, newline included.
- One process owns the workspace (`open.pid`), and a per-file queue in it serializes lines, so lines never interleave and no read-modify-write is needed.
- The handle is opened for a burst and closed after it, because OneDrive will not sync a file an app holds open.
- fsync at four commit points, coalesced per burst: after a user message, before a tool runs (its `input-available` part), after a tool's output, and when a step finishes. On macOS Node's `fsync` is `F_FULLFSYNC`. Every line survives an app crash; only power loss can take lines since the last commit point.
- A blob is written to `blobs/.~sha256-<hex>.<ext>.tmp` (a name iCloud, OneDrive and Dropbox all skip), fsynced and renamed into place. Same bytes, same name on any device, so two writers cannot conflict.

## Recovery

1. Readers take only lines that end in `\n`, parse, and carry a larger `seq` than the line before; anything else is counted and skipped.
2. Before its first append, the writer adds `\n` if the file does not end in one, so a torn fragment stays a skipped line.
3. If a log is shorter than the index last saw, or its tail no longer matches the index's hash, the writer stops using it and starts `<session>.<device>.2.jsonl` (then `.3`), whose header carries `continues`. It never writes on top of a file it does not recognize.
4. On the first open after a process died mid-turn: a part snapshot per tool call left in `input-*`, marking it interrupted (today's `sweepInterruptedToolCalls`), and a message snapshot marking an unfinished step aborted.

## Today's overwrites become appends

| Change | Today | Here |
|---|---|---|
| Text or reasoning streams | Whole part upserted every 100 ms or 4 KB (`DELTA_SAVE_*` in `logic/llm-request.ts`) | Nothing written while it streams. At text end or reasoning end, one part line with the whole text. |
| A tool call runs | Read-modify-write at each state | `input-available` (before anything runs) and the final output are part lines. Input streaming and preliminary output stay in memory. |
| A step finishes | Message row overwritten with usage and finish reason | A second message line for the same id |
| Title, star, archive, unread, topics, Stop | Fields on the session row, through `saveMark` | A mark line in this device's marks file |
| `updatedAt` every turn | Session row rewritten | Not stored: the newest record's `at` |
| Baselines and browser hosts | Keys replaced whole | A `told` line per change |
| Rollover | Two session fields and a part on the newest message | A `rollover` line and the same `data-contextRollover` part line |
| System prompt changes | Session-context messages deleted and written again | `retract` for the old ones, then new message and part lines |
| A task starts | A session row with `parentId` and `forkedAtMessageId` | A new log whose header names `parent` and `forkedAt` |
| Edit a user message (planned) | Not built | `retract` from that message on, then the new message |
| Archive; delete a chat | `archivedAt` on the row; delete trashes the chat | A mark; delete still trashes the record folder, logs and blobs with it |

## `workspace.db`

One file in `workspaces-data/<local id>/`, WAL, `synchronous = NORMAL`, owned by the workspace's process.

- Index tables, rebuildable from the folder: `files` (path, size, mtime, tail hash, folded offset, last `seq`, whether the file is downloaded), `chats` (today's `chat_digests`), `sessions` (header, rollover, stopped, merged marks), `messages` (id, session, role, created, first and last byte offset, for paging), `task_hosts`, `task_standings`. Later, with the visible folders, the front matter of topics, drafts and memories, and full-text search.
- Records, not rebuildable: `activity` (today's `ai-usage` rows) and `window_browser_visits` (what `browser-state` held for the window's own tabs).
- Rebuild drops and refolds the index tables only; their schema version bump triggers it. A corrupt file is moved aside and recreated, which loses the activity log; nothing billing depends on it.
- Replaces `index/chats.db` (the `index/` folder goes), `.instrument/ai-usage.db` (its rows move in) and `.instrument/window/chat.db` (empty except its migration marker on every install checked; deleted).
- On launch: stat every log and marks file. Unchanged means the stored digest stands; grown means fold only the new bytes from the saved offset; anything else means refold that file. A file another device grew is noticed when the window comes forward and on a slow timer while it is in front, plus one non-recursive watch on the open chat's record folder. This computer's own writes update the index directly.

## Read side

Each open chat has one fold in memory, updated by its own appends. Views read the fold or the index; nothing reads a message at a time.

| View | Serves | Replaces | Built from |
|---|---|---|---|
| list | Chat list, header, status line rows, tasks popover | `chats.live.list`, `chats.live.tasks`, `chats.live.info`, `chats.session`; the digest reads in `lib/chat/chats.ts`, `activity.ts`, `standing.ts`, `children.ts`, `lib/chat-info.ts`, `lib/usage-summary.ts` | `workspace.db`, plus the running chat's in-memory state |
| conversation | What the chat view draws for everyone, and the task page's transcript | `message.live.list` (full read, then rereads of changed messages) | The fold: user messages with `data-attachments`, `data-viewContext`, `data-reply`; finished assistant messages with their text (files and message fences); `data-asks`, `data-folderChanges`, `data-permissionAnswer`, `data-fileChanges`, `data-skillChanges`, `data-modelChange`, `data-taskEvent` (stopped by the person or the app), `data-fromChat`; `tool-choose` and `tool-connect_app`; message errors and `max-steps` |
| live | The running turn: status line step, typing dots, permission asks, whether the agent runs, the task page's streaming text and running calls | `chats.live.activity`, `permissions.liveAsks`, the in-flight half of `message.live.list`, `latestStepIn` reading `input-streaming` parts | Memory only, never disk |
| steps | Every tool call, reasoning and developer-only data part in order, for developer mode, the task page's tool rows, `task log`, wake notes, and the X-ray view later | `lib/chat/steps.ts`, `latest-session.ts`, the reads in `wake.ts`, `shell-commands/task/fork.ts` | The fold, interleaved by part id so developer mode can merge it with conversation |
| model history | The model request | Reads in `lib/prepare-model-messages.ts`, `date-change.ts`, `message-gap.ts`, `turn-note.ts`, `loaded-skill.ts`, `browser-skill-delivery.ts`, `new-message.ts`, `chat/folder-reach.ts`, `agents/instrument.ts`, `machines/agent.ts`, `machines/session.ts` | The fold from the last rollover forward; blobs read and encoded at send time |
| search | The agent's `chat read` and `chat search` | `lib/shell-commands/chat.ts` | Fold and scan, skipping files the index marks not downloaded; full-text search later |

Also from these views: transcript copy and save (conversation, or steps in developer mode, rendered to Markdown), `session.live.contextTokens` and usage (message metadata in the index), titles (`retitle.ts`, `generate-session-title.ts`, `update-session-title.ts` read the conversation and write a mark).

A chat being opened is checked first for a log that is not downloaded (`st_blocks == 0` on a non-empty file); the window says it is downloading while the Mac bridge asks for it.

## Converter

- Runs at launch after `migrateWorkspaceLayout`, before anything opens a chat, guarded by a mark in `workspace.json` written only once every chat converted.
- Per chat: read `chat.db` through a read-only reader kept for this purpose (store migrations and the interrupted-call sweep applied first), write logs, marks and blobs into a temp folder beside the chat, fsync, rename into place.
- Verify: fold the new files through the new reader and compare every session, message and part with the old read, field by field, after both pass the Zod schemas. Any difference leaves that chat on `chat.db`, logged, retried at each launch, and listed as unavailable.
- Move each converted `chat.db` to `set-aside/chat-db/` on this computer, out of the synced folder. Deleting the set-aside copies is a later release's call.
- Bump `formatVersion` in `workspace.json`, so an older build refuses the folder (`workspace-refusal.ts`) instead of showing empty chats.
- The 1.x migration (`migrate-legacy-tasks.ts`) writes logs directly, so no `chat.db` writer survives. Beta.61 data reaches `.instrument/chats/<id>/chat.db` through the layout migration and converts from there.

## Phases

| # | Phase | Done means |
|---|---|---|
| 0 | This plan and record spec | Reviewed |
| 1 | Log layer: record schemas, append with newline repair and commit-point fsync, handle closed after each burst, whole-line reader, blobs, device id | Unit tests, including torn lines and a crash mid-write |
| 2 | Fold, and a fake sync engine for tests | Property tests: any file order, duplicates, truncations or conflict copies give the same chat, or a flagged fork; never a crash or a silent loss |
| 3 | `workspace.db`: index with per-file cursors, rebuild, activity log and window visits moved in; `index/`, `ai-usage.db` and the window store removed | A rebuild matches the incremental index exactly |
| 4 | Swap the store: records written when they settle, the six views in place of the `Store` queries, renderer routes pointed at the views; `Store`, the KV table, superjson and delta persistence deleted | The app runs on the new store |
| 5 | Converter, and the 1.x migration writing logs | A clone of a real install (392 chats) converts with zero differences; a chat that differs stays on `chat.db` |
| 6 | Everything visible in the Instrument folder, and the machine-side cleanups: [instrument-folder.md](instrument-folder.md) | As that plan says |

## Testing

Local correctness first, and most of the time:

1. Unit and property tests per layer, as in the phases.
2. The converter on a copy-on-write clone of a real install, and on the Mac VM with data in beta.61's shape.
3. The app driven on a disposable workspace on one Mac, a screenshot of every surface: new chats, tool calls that return images, tasks, Stop, a rollover, title, star and unread, the task page, developer mode, export, and quitting mid-turn then reopening.
4. Converted chats opened in the app, comparing what the old store and the new views hand the window for the same chat.
5. Windows and Linux: the unit suites on the test hosts plus one app boot each, mainly for file handles, `O_APPEND` and rename.
6. No evals unless the agent's `chat` or `task` commands change their output; any eval run is approved first.

Syncing between devices last: the fake sync engine covers late, partial, duplicated and evicted files from phase 2; real iCloud Drive between two Macs waits until the second Mac is online.

## Open items

- A memory-saved card shown to everyone, outside developer mode, including what forked tasks remember.
- Showing a forked session (two devices continuing one chat).
- A first-party sync service with its own API, which would make the lease and live watching possible.

Decided elsewhere: attachments, drafts and the visible folders are in [instrument-folder.md](instrument-folder.md).

## Not in this plan

- A lease or lock between devices.
- Rolling logs at a size limit.
- A phone reader or writer.
- Converting the set-aside beta task stores.
