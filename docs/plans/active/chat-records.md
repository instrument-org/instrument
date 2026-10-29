# Plan: chat records as append-only logs, one per session per device

Status: built and landed, but for the two parts named here. Phases 1, 2 and 4 are built and phase 5's acceptance run has passed (see [What the acceptance run covered](#what-the-acceptance-run-covered)). Phase 4 is finished down to the store: `Store`, its KV table, superjson and the delta persistence are gone, and a chat is written through `ChatWrites` and read through `ChatReads`. [The chat's own settings](#the-chats-own-settings) are built as that section says, with the deviations it records: nothing writes `settings.json`, and a launch step carries an existing one into the records and the machine folder, then removes it. Phase 3 shipped as `workspace-index.ts` rather than the incremental index described below: one derived value per chat or session (`chat_digests`, `task_hosts`, `task_standings`), stamped by the sizes and mtimes of its chat's files, so a changed chat refolds whole (a chat held in memory takes only the bytes another device's file gained, through `ChatRecords.catchUp`, which `RecordArrivals` calls while the app runs; see the architecture doc's Syncing section). Per-file cursors, a `messages` table for paging and full-text search are deferred until a warm stamp pass over the chat list takes more than about 150 ms, or one chat's refold more than about 50 ms. Phase 5's 1.x migration still writes a `chat.db` for the converter to read rather than writing logs itself. Phase 6 is [instrument-folder.md](instrument-folder.md).

A chat's record today is a SQLite file, `chat.db`, inside the workspace's `.instrument/` folder, which the person may put in iCloud Drive, Dropbox or OneDrive. A sync engine copies files whole and can upload a database mid-transaction, and today's store rewrites nearly every row after its first write (a streaming part is saved whole every 100 ms). This plan makes the record append-only JSONL that a sync engine can carry safely, keeps one rebuildable SQLite database on each computer, and rebuilds the read side around what the window draws today.

Supersedes the backing-store phases of [conversation-storage.md](../completed/conversation-storage.md) and [long-lived-conversation-storage.md](../completed/long-lived-conversation-storage.md), and folds in [tool-result-media-dedup.md](../completed/tool-result-media-dedup.md) with blobs per chat instead of per workspace. The views replace the route [incremental-live-transcript-updates.md](incremental-live-transcript-updates.md) reworks. Attachments, drafts and the visible folders are in [instrument-folder.md](instrument-folder.md), which supersedes [chat-attachments-by-reference.md](../completed/chat-attachments-by-reference.md). Research behind the choices: [syncing-a-data-folder-through-file-sync.md](../../findings/syncing-a-data-folder-through-file-sync.md).

## Decisions

- The record is JSONL in the chat's record folder `.instrument/chats/<id>/`, which travels with the workspace. Per-chat SQLite goes away.
- One log file per session per device, and one settings file per device. Every file has exactly one writer: the device its name carries.
- A change is a new line, never an edit. The newest snapshot of a message or part wins.
- Only settled records are written. Streaming deltas are never persisted, and there is no journal for them; a crash mid-reply loses the unfinished part, which then reads as interrupted.
- Live data (a tool call's `activity` while its input streams, the task page's streaming text) stays in memory and goes to the window only. A permission card the person has not answered is the exception: it is kept under `waitingOn` in this device's state file for the chat (`state.<device>.json`), because what it grants is this computer's, the chat list reads every chat's open asks, and a card has to be there again after a relaunch. A question the agent asked with `choose` is read from the log instead: its call, with no answer on it and nothing the person wrote or stopped since.
- Images and every other binary a tool returns become blobs named by their hash in the chat's `blobs/`, which travel with the chat.
- Big command output stays on this computer, in `work/<chat>/.tool-output/`, as today; the log keeps its head, tail and path.
- One SQLite database per workspace on this computer, `workspace.db`: the index and the activity log.
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
| settings | `settings.<device>.jsonl`, every per-chat value one device set, for every session in the chat: title, star, archive, unread, topic, and the chat's model |
| fold | reading every log and settings file of a chat into sessions, messages and parts |
| view | a read shaped for one screen or caller, made from the fold or the index |
| device id | `dev_` plus 8 Crockford base32 characters, one per install per machine |

## On disk

```
<workspace>/.instrument/chats/<chat id>/        travels with the workspace
  <session id>.<device id>.jsonl                one per session per device
  <session id>.<device id>.2.jsonl              after this device read newer records from another device's log, or recovery refused the first
  settings.<device id>.jsonl                    every per-chat value, from this device
  blobs/sha256-<hex>.<ext>                       written once through a temp name
  attachments/                                  as today, until instrument-folder.md moves it out
  handoff-notes.md                              as today, until instrument-folder.md moves it out

<userData>/machine/<local id>/                  this computer only
  workspace.db                                  index, activity log
  chat-folders.json                             each chat's folder name under Chats/, by chat id
  permissions.json                              what each chat allowed and refused, under chats
  set-aside/chat-db/<chat id>.db                converted chat.db files
  work/<chat id>/.tool-output/                  big command output, as today
<machine>/machine-state.json                    adds deviceId and hardwareId
```

The folder holds no SQLite, no lock file and no file anyone rewrites in place.

## The chat's own settings

`settings.json` is the one file in the synced folder that every computer writes. It is read, changed and written whole, and the queue that serializes that only reaches one process on one machine. Two machines changing a chat at once is last-writer-wins, the sync engine makes `settings 2.json`, and nothing reads it: one machine's change is gone without a trace. It is the only place the format's own rule, one writer per file, is broken.

It is replaced by `settings.<device id>.jsonl`, which is the marks file renamed and widened, since what that file already held was never only marks: a title and a list of topics are not marks in the starred sense. One writer, append only, merged newest-wins per session and field with the larger device id breaking a tie, and a title the app may still rename never beating one that settled. Its lines read `{"t":"set","seq":…,"at":…,"session":…,"field":…,"value":…,"device":…}`. A line names its session because a task's title is set the same way as the chat's; the chat's own values (its model) are set on the chat's own session.

Six fields, and nothing else:

| Field | Value | |
|---|---|---|
| `title` | `{ text, auto }` | `auto` is true while the app may still rename it: it is the app's heuristics that change, not who typed it |
| `starred` | boolean | |
| `archived` | boolean | |
| `unread` | `"new"` or `"marked"`, `null` once read | `"new"` clears when the person looks at the chat; `"marked"` is deliberate and does not. A status rather than a flag, since there will be other reasons a chat becomes unread |
| `topic` | a topic id | The one opaque value in the file, so renaming a topic's folder does not empty it. Singular: a chat is filed under one topic, settled 2026-10-16, replacing the list |
| `model` | the whole model URI | Set on the chat's own session. Kept as written: a URI this build cannot parse reads as none, rather than as a skipped line that would let an older pick win |

A field set to the value it already holds writes nothing, so the file grows only on real changes and keeps the moment each was first made. Nothing is ever rolled up: compaction means rewriting a file, and append-only with one writer is what makes merging safe. The history is cheap and gives previous titles, the models a chat has used, and an undo, for free.

`stoppedAt` goes. A stop is a `stop` record in the session log, which carries `by: person | agent | app` and sits in order with the conversation, where a fact about a turn belongs. Stop on the chat's own turn writes one through `ChatRecords.stopped` at the moment it was pressed (`markChatStopped`), unless a person's stop from that moment on is already there, and the turn's own later save of its stop compares against the known stop, so the log carries one. The chat reads as stopped while that record's `at` is at or after the newest message that started a turn.

The model is stored whole, `openai/gpt-6.1-sol?provider=chatgpt-account&providerConfigId=01M4RQ…`, and matched loosely on read: the exact configuration if this computer has it, otherwise any configuration of that provider, otherwise the workspace default. Storing less would break the person who has two accounts with one provider, and requiring an exact match would break every second computer, since the configuration id names a row that is this machine's.

What leaves `settings.json` and does not come here:

- `chatSessionId`, `createdAt`, `createdWithAppVersion` and `lastActivityAt` are derived from the records. A chat's own session is the one whose log header names no parent (`chatSessionIn`), so no file a device rewrites can hide a chat. Its start is that session's, the build it began on is its first log header's `app`, and its activity is the newest log record of any of its sessions; a setting (a star, a read mark, a model pick) is not activity.
- `folder` is this computer's: the name of the chat's folder under `Chats/` is kept in the workspace's machine folder, `chat-folders.json`, by chat id, and is where to look first. What says a folder is a chat's is its `CHAT.md`, whose front matter names the chat: where the recorded folder is gone, the one folder no other chat claims that names the chat is taken as its own whenever the chat's folder is written (a turn ending, the person sending a message) and by the shell's lookup, so a folder renamed in a file manager while the app runs is followed rather than split in two.
- `state.browserTabs` and the rest of a device's state are in `state.<device>.json`; what a chat allowed and refused is in the machine folder's `permissions.json`.
- `reasoningEffort` was in the schema, in none of the 688 files on disk, and surfaced nowhere; it goes. An eval's `--effort` pins it for the whole run in the workspace config instead.

At launch, after the database converter, each chat's `settings.json` is carried once (`convert-chat-settings.ts`): the model onto the chat's own session unless a device already set one, the permissions into the machine folder unless it already answers for the chat, a state an earlier build kept there into this device's state file, and then the file is removed. A chat still on its `chat.db` keeps the file, which names its session until its records do; a file that cannot be read is left in place, and nothing reads it.

## The device id

- Stored in `machine-state.json` as `deviceId` with `hardwareId`, a SHA-256 of the machine's own id. The hash never goes into the workspace folder.
- The machine's id: macOS `IOPlatformUUID` (from `ioreg -rd1 -c IOPlatformExpertDevice`), Windows `MachineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography`), Linux `/etc/machine-id` (falling back to `/var/lib/dbus/machine-id`).
- At launch, a missing `deviceId` or a `hardwareId` that does not match the machine makes a new random device id. Same hardware keeps its id across reinstalls of the app's data only if `machine-state.json` survives; a fresh id is always safe, since it only means a new file.
- If the machine's id cannot be read, the app keeps the stored device id and logs why.
- A phone binds its id the same way, to a hash of what iOS gives it for the device, for the reason the desktops do: a phone restored onto new hardware must not keep writing the file its old one wrote.
- A device that only marks chats read, starred or archived writes nothing but its own `settings.<device>.jsonl`, and the fold takes its settings without a log of that device anywhere, since a settings file carries no header.

## Records

Every line is one JSON object, keys in this order so a reader can skip by prefix: `{"t", "seq", "at", ...}`. `seq` counts up from 0 within the file. `at` is an ISO date. Dates elsewhere are ISO strings that the existing Zod schemas turn back into `Date`s; superjson goes away, and an explicit `undefined` is simply absent.

| `t` | Fields after the envelope | Fold rule | Replaces |
|---|---|---|---|
| `session` | `format`, `id`, `chat`, `createdAt`, `device`, `app`; a task adds `parent`, `forkedAt`, `handle`, `title`; every log after the first adds `continues: {<log stem>: <seq>}`, how far its writer had read each earlier log of the session (a stem is `dev_X` or `dev_X.2`) | First line of every log. A file whose first line is not a header is refused, not repaired. | the immutable half of `sessions:<s>` |
| `message` | `message: {id, role, metadata}`, today's `SessionMessage` | Newest snapshot per id wins. Messages ordered by id (ULID), as today. | `messages:<s>:<m>` |
| `part` | `part`, today's part with `base64Data` swapped for `blob`, `mediaType`, `bytes` | Newest snapshot per part id wins. Parts ordered by id under their message. | `parts:<s>:<m>:<p>` |
| `retract` | `messages: [ids]` | Drops those messages and their parts from the fold. Ids are never reused. | `removeMessage` |
| `rollover` | `after`, `usableTokens` | Newest wins; same meaning as `rolledOverAfterMessageId` today. | two session fields |
| `stop` | `by: person, agent or app` | Applies until a message that starts a turn follows it. | `stoppedBy` |
| `sites` | `visited: [hosts]`, the whole list | Newest wins. | `browser-state:<s>` |
| `set` (settings file only, no header) | `session`, `field`, `value`, `device`. Values as [the chat's own settings](#the-chats-own-settings) lists them | Across every device's settings file, newest `at` per (session, field) wins, ties going to the larger device id. A title the app may still rename never beats one that settled. The winning line's `at` is when it was set (today's `starredAt`, `archivedAt`, `unreadAt`, `titleSettledAt`). | the mark half of `sessions:<s>`, and `settings.json` |

A session's history is its own logs; a task's is its parent's fold up to `forkedAt` (by message id, never by byte offset), then its own logs.

Records from several logs of one session are ordered by place: the sum of the header's `continues` plus the record's own `seq`, ties going to `at`, then the log, then a hash of the line. That holds because a device that has read another device's newer records starts its next log with a header saying so, rather than appending to the old one. Two logs that each hold records past what the other's writer had read of that session are a fork: the fold keeps both continuations and flags the session. Its display is outside v1. A record is known by its log, place, `seq` and line hash, so an identical copy from a sync conflict folds once and a copy whose bytes differ keeps both.

Dates inside tool outputs come back as ISO strings; their readers coerce them.

What a session was last told of what changes under it (its folders, apps, memory, skills, background processes, computer) is not a record: the baseline's metadata holds the picture it began with and each note since carries what it brought the model up to, so it is read from the session's history (`last-told.ts`). The five baseline keys `chat.db` kept are left behind.

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
| Title, star, archive, unread, topic, model | Fields on the session row, through `saveMark`; the model in `settings.json` | A `set` line in this device's settings file |
| Stop on the chat's own turn | `stoppedAt` on the session row | A `stop` record in the session's log, at the moment Stop was pressed |
| `updatedAt` every turn | Session row rewritten | Not stored: the newest record's `at` |
| Baselines | Keys replaced whole | Nothing: read from the notes in the session's history |
| Browser hosts | Key replaced whole | A `sites` line per new host |
| Rollover | Two session fields and a part on the newest message | A `rollover` line and the same `data-contextRollover` part line |
| System prompt changes | Session-context messages deleted and written again | `retract` for the old ones, then new message and part lines |
| A task starts | A session row with `parentId` and `forkedAtMessageId` | A new log whose header names `parent` and `forkedAt` |
| Edit a user message (planned) | Not built | `retract` from that message on, then the new message |
| Archive; delete a chat | `archivedAt` on the row; delete trashes the chat | A `set` line; delete still trashes the record folder, logs and blobs with it |

## `workspace.db`

One file in `machine/<local id>/`, WAL, `synchronous = NORMAL`, owned by the workspace's process.

- Index tables, rebuildable from the folder: `chat_digests` (what a chat list row draws: title, marks, the first ask, the last reply's first line, steps, files and sites), `task_hosts` and `task_standings`, each a value per chat or session with the stamp of the files it was folded from. Also `own_log_cursors`, where this device's own log for each session ends. Per-file `files`, `sessions` and `messages` tables (byte offsets for paging), and later the front matter of topics, drafts and memories and full-text search, are deferred.
- Records, not rebuildable: `activity`. The window's own tabs have kept no browser state since beta.55, so there is nothing of the window's to keep here.
- Rebuild drops and refolds the index tables only; their schema version bump triggers it. A corrupt file is moved aside and recreated, which loses the activity log; nothing billing depends on it.
- Replaces `.instrument/window/chat.db` (empty except its migration marker on every install checked; deleted).
- On read: stat the chat's log and settings files. Unchanged means the stored value stands; anything else means refold that chat. A file another device grew is noticed when the window comes forward and on a slow timer while it is in front, plus one non-recursive watch on the open chat's record folder. This computer's own writes update the index directly.

## Read side

A chat has two doors. `ChatReads` answers from the views over one fold, with the writes still on their way to disk over it and the running turn beside them; `ChatWrites` is the only way anything is written, and waits for each append, since a write nobody waits on is a message the person sent and the chat does not have. A process with no records in place holds no chat at all.

Each open chat has one fold in memory, updated by its own appends. Views read the fold or the index; nothing reads a message at a time.

| View | Serves | Replaces | Built from |
|---|---|---|---|
| list | Chat list, header, status line rows, tasks popover | `chats.live.list`, `chats.live.tasks`, `chats.live.info`, `chats.session`; the digest reads in `lib/chat/chats.ts`, `activity.ts`, `standing.ts`, `children.ts`, `lib/chat-info.ts`, `lib/usage-summary.ts` | `workspace.db`, plus the running chat's in-memory state |
| conversation | What the chat view draws for everyone, and the task page's transcript | `message.live.list` (full read, then rereads of changed messages) | The fold: user messages with `data-attachments`, `data-viewContext`, `data-reply`; finished assistant messages with their text (files and message fences); `data-asks`, `data-folderChanges`, `data-permissionAnswer`, `data-fileChanges`, `data-skillChanges`, `data-modelChange`, `data-taskEvent` (stopped by the person or the app), `data-fromChat`; `tool-choose` and `tool-connect_app`; message errors and `max-steps` |
| live | The running turn: status line step, typing dots, permission asks, whether the agent runs, the task page's streaming text and running calls | `chats.live.activity`, `permissions.liveAsks`, the in-flight half of `message.live.list`, `latestStepIn` reading `input-streaming` parts | Memory, except the open asks themselves, which this device's `state.<device>.json` keeps |
| steps | Every tool call, reasoning and developer-only data part in order, for developer mode, the task page's tool rows, `task log`, wake notes, and the X-ray view later | `lib/chat/steps.ts`, `latest-session.ts`, the reads in `wake.ts`, `capabilities/task/fork.ts` | The fold, interleaved by part id so developer mode can merge it with conversation |
| model history | The model request | Reads in `lib/prepare-model-messages.ts`, `date-change.ts`, `message-gap.ts`, `turn-note.ts`, `loaded-skill.ts`, `browser-skill-delivery.ts`, `new-message.ts`, `chat/folder-reach.ts`, `agents/instrument.ts`, `machines/agent.ts`, `machines/session.ts` | The fold from the last rollover forward; blobs read and encoded at send time |
| search | The agent's `chat read` and `chat search` | `lib/shell-commands/chat.ts` | Fold and scan, skipping files the index marks not downloaded; full-text search later |

Also from these views: transcript copy and save (conversation, or steps in developer mode, rendered to Markdown), `session.live.contextTokens` and usage (message metadata in the index), titles (`retitle.ts`, `generate-session-title.ts`, `update-session-title.ts` read the conversation and write a mark).

A chat being opened is checked first for a log that is not downloaded (`st_blocks == 0` on a non-empty file); the window says it is downloading while the Mac bridge asks for it.

## Converter

- Runs at launch after `migrateWorkspaceLayout`, before anything opens a chat, guarded by a mark in `workspace.json` written only once every chat converted.
- Per chat: read `chat.db` through a read-only reader kept for this purpose (store migrations and the interrupted-call sweep applied first), write logs, settings and blobs into a temp folder beside the chat, fsync, rename into place.
- Verify: fold the new files through the new reader and compare every session, message and part with the old read, field by field, after both pass the Zod schemas. Any difference leaves that chat on `chat.db`, logged, retried at each launch, and listed as unavailable.
- Move each converted `chat.db` to `set-aside/chat-db/` on this computer, out of the synced folder. Deleting the set-aside copies is a later release's call.
- Bump `formatVersion` in `workspace.json`, so an older build refuses the folder (`workspace-refusal.ts`) instead of showing empty chats.
- The 1.x migration (`migrate-legacy-tasks.ts`) writes logs directly, so no `chat.db` writer survives. Beta.61 data reaches `.instrument/chats/<id>/chat.db` through the layout migration and converts from there.
- The reader the converter uses keeps the layers under it alive: the key-value table, `superjson`, the store migrations and the interrupted-call sweep are all how a `chat.db` is read. Phase 4 deletes the writer, not the reader.

### What the acceptance run covered

A clone of the install this plan names converts whole: every chat's records read back as its `chat.db` held them, field for field, and a run over the same folder again finds each chat already converted and writes nothing. The run covers the chats the layout sweep makes out of that install's remaining 1.x tasks, and a second corpus of the databases an earlier conversion set aside. The 1.x migration still writes a chat's rows into a `chat.db` for the conversion to read, rather than writing its logs itself, so a `chat.db` writer does survive for the chats it makes.

What that install's own history leaves to the fixture in `convert-chat.test.ts`: a rollover, a stopped turn, an unread mark, a task as a session, and a tool output with bytes in it. Its chats hold one session each, because a task of that era kept a database of its own, which this plan leaves set aside. What it does exercise heavily is a payload no schema here reads: a part type 1.x wrote accounts for a twentieth of its part lines, each held as its row was written rather than as a read of it gives.

## Phases

| # | Phase | Done means |
|---|---|---|
| 0 | This plan and record spec | Reviewed |
| 1 | Log layer: record schemas, append with newline repair and commit-point fsync, handle closed after each burst, whole-line reader, blobs, device id | Unit tests, including torn lines and a crash mid-write |
| 2 | Fold, and a fake sync engine for tests | Property tests: any file order, duplicates, truncations or conflict copies give the same chat, or a flagged fork; never a crash or a silent loss |
| 3 | `workspace.db`: per-chat derived values stamped by their files, rebuild; the window store removed | A stamp miss refolds to the same value a fresh fold gives |
| 4 | Swap the store: records written when they settle, the six views in place of the `Store` queries, renderer routes pointed at the views; the `Store` and its writes to the key-value table deleted, and nothing persisted while a part streams | The app runs on the new store |
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

For a workspace shared between people, none of which needs a format change, since the device file and the rules in [chat-records.md](../../architecture/chat-records.md#changing-the-format) already leave room:

- Starred, archived and unread are one person's. Once a device file names a `person`, those three fold over that person's devices only; title, topic and model stay shared. Devices that name no person are all the workspace's owner, as every device is today.
- Which device is running a session's turn: a `running` entry (session, since, heartbeat) in that device's `state.<device>.json`, which other devices read. A real lease waits on the sync service; through a file sync engine it can only be a marker.
- A device that reads another's records starts a new log of the session (`<session>.<device>.2.jsonl` and on). Two people trading messages would make a file per exchange; an in-log record of what was read would replace the new file, with new logs kept for recovery.
- What is one person's should sit where a sync service can withhold it by path: `state.<device>.json` sits in each chat's record folder, and the activity log and the bookmarks are workspace-wide.
- Task handles (`t2`) are picked from what one device has seen, so two devices that have not synced can give two tasks one handle. Session ids still differ; the fold should tell the two apart for display.
- Whose `Memory/` and `Drafts/` are, in a shared workspace, is a product decision.
- Paths in the agent's own words and tool calls stay as it wrote them. Reading one written on another computer at this one's paths would use the `environment` the session recorded, and needs no change to what is written.
- A relative path the agent writes is read against the chat's work folder, which is on one computer only.
- `workspace.json` is rewritten whole by whichever device runs a launch migration.

Decided elsewhere: attachments, drafts and the visible folders are in [instrument-folder.md](instrument-folder.md).

## Not in this plan

- A lease or lock between devices.
- Rolling logs at a size limit.
- A phone reader or writer.
- Converting the set-aside beta task stores.
