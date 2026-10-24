# Chat records

A chat is a folder of append-only files, one per session per device, and nothing else. Every read of a chat is a view over those files; every write appends to them. There is no database holding a chat's messages: `workspace.db` is an index of what the files already say, rebuildable by reading them again.

This is the map. [The plan](../plans/active/chat-records.md) carries the record spec and the reasoning behind the format.

## The files

In the chat's record folder (`chats/<id>/`, resolved by `record-folders.ts`):

| Name | What it holds |
|---|---|
| `<session>.<device>.jsonl` | One session's log, as that device wrote it: its header, its messages and parts, where its context window was reset, who stopped its turn, the sites its browser went to |
| `settings.<device>.jsonl` | Every per-chat value that device set, one `set` line per change: each session's title, star, archive, unread and topic, and the chat's model on its own session. A Stop is not a setting: it is a `stop` record in the session's log, at the moment it was pressed, saying who stopped the turn (`person`, `agent` or `app`). |
| `state.<device>.json` | Where that device left off in the chat (its tabs, the folders and apps its agent waits on it to allow), written and read by that device alone (`chat-record.ts`) |
| `blobs/sha256-<hex>.<ext>` | The bytes a part points at, named by their hash, so the same bytes get the same name on every device |

Nothing in the folder is rewritten whole by more than one device. What a chat is comes from its logs: its own session is the one whose header names no parent (`chatSessionIn` in `record-folders.ts`), its start is that session's, the build it began on is the `app` in its first log's header, and its last activity is the newest log record of any of its sessions. The chat list orders chats by when the person last sent a message in one (`lastUserMessageAt`, `byLastUserMessage`), so an agent's work does not move a chat up. A setting merges per session and field, the newest `at` winning and the larger device id breaking a tie, so two computers changing different things about one chat both keep their change.

A chat's title is its newest `title` setting. Its own session's header starts it as `startedAs`, the first words of its opening ask (`openingTitle` in `chat/shown-title.ts`, the untitled placeholder when the ask had no words), so a device that has synced the log and not yet the settings file naming the chat still shows the words the chat list shows. The app reads that header title as untitled (`startedTitle` in `records/session-of.ts`), so the chat is still named from its first message and again when its first exchange settles; that name goes in the settings, and the header is never rewritten. A task's header `startedAs` is its name.

What is this computer's about a chat stays in the workspace's machine folder: the name of the chat's own folder under `Chats/` (`chat-folders.json`, `chat-folders/own-folder.ts`), and what the chat allowed and refused (`permissions.json`). The name is where to look first; where that folder is gone, the one folder under `Chats/` no other chat claims whose `CHAT.md` names the chat is taken as its own the next time the chat's folder is written, and found the same way by the shell meanwhile, so a folder renamed in a file manager is followed. The folder and its `CHAT.md` are written when a turn ends and when the person sends a message (`chat-folders/write-chat-folder.ts`), never by a pass over every chat at launch.

A record is one JSON object on one line, `t`, `seq` and `at` first (`records/record.ts`). A device only ever appends to files that carry its own id, so two devices writing the same chat never write the same file, and a sync engine has nothing to merge. The conflict copies it makes anyway (`file-names.ts` knows their shapes) are read like any other file.

Who wrote a record is its device: a log's header names it, and so does every settings line. Each device says which computer it is in the workspace's `.instrument/devices/<device>/device.json` (`records/device-file.ts`), written by that device alone and only when its name or platform changes: the computer's own name and `process.platform`. A device stands for a person, and every device whose file names no `person` is the workspace's owner. A service that vouches for who is behind a device may add `person: { id, name, issuer }`, which the app carries forward and writes none of. A device id never spans two people, so a device that changes person starts as a new one.

## Changing the format

Devices sharing a workspace run whatever build each has, so a change to anything in these files has to read safely on a build older and a build newer than the one making it.

- An additive change never bumps the header's `format` or `workspace.json`'s `formatVersion`. Either bump makes every older build refuse what it covers: a session's logs, or the whole workspace.
- New meaning goes in a new record type, a new field, or a new setting field, which an older build skips or strips. A new value is never added to an existing enum (`stop.by`, a setting's `field`), since an older build drops the whole line rather than the value.
- A reader skips what it does not know (a record type, a setting field, a part type, which reads as `data-unknown`) and never fails on it.
- A file a device rewrites whole carries forward the fields it does not know (`json-record-file.ts`).

## Writing

`ChatWrites` (`lib/chat-writes.ts`) is the only way a chat is written, and every function on it waits for its append. A write nobody waits on is a message the person sent and the chat does not have.

Under it, `ChatRecords` (`records/chat-records.ts`) owns this device's files while the workspace is open: one service per process, on the main thread, installed at workspace open and disposed at quit. It holds each open chat's fold, a queue per file so lines never interleave, and the running turn's memory. `record-writer.ts` gives each record its `seq`; `open-log.ts` opens a handle for a burst and closes it after, because a sync engine will not sync a file an app holds open; `sync-directory.ts` makes a folder's names durable where the filesystem needs asking.

A part still arriving is never a record: text or reasoning being streamed, a call whose input is still being typed, and the preliminary output a tool gave before its own (`records/arriving.ts` is the one definition). Those live in the turn's memory, where every read of the chat sees them, and the snapshot that settles one is what gets written. So a reply's text is written once, whole, however many deltas it arrived in. A turn the person stops writes the text it had reached, marked as cut off; a process that exits mid-stream without stopping leaves nothing of it behind.

A tool's returned bytes go to a blob and the part keeps the blob's name, media type and size (`part-blobs.ts`), so a log stays text and the same image returned twice is stored once.

A path the app puts in a part (the folders a chat was granted, what was on screen or chosen when a message was sent, the file a question was about, the files a task named) is kept by its place in the workspace when it is in it, `workspace:/Chats/Plan/plan.md`, and at its own absolute path when it is not (`part-paths.ts`). `ChatRecords` writes them that way and its fold reads them back as this computer's host paths, so every reader sees a path it can open, and the same record names the same file on a computer that keeps the workspace somewhere else. A file the person attached keeps its own form (`attachments.files`), and the agent's words and tool calls keep the paths it wrote.

## Reading

`ChatReads` (`lib/chat-reads.ts`) answers every read, from one `ChatRead`: the fold, the writes still on their way to disk over it, and the running turn beside them. A process with no records in place holds no chat at all and is told so rather than left to assume.

`fold.ts` reads every log and settings file in the folder into sessions, their messages and parts. Folding is order-independent: any file order, duplicates, truncations or conflict copies give the same chat. `read-records.ts` takes a record only from a line that ends in `\n`, parses, and carries a larger `seq` than the one before it; everything else is counted and skipped, which is what makes a crash mid-append a skipped line rather than a broken chat.

The views (`records/views.ts`) are what callers actually use: `list` (the chat list and header), `conversation` (what the chat view draws), `steps` (tool calls, reasoning and the developer-only parts), `live` (the running turn, memory only), and `modelHistory` (what a request is built from, blobs read back at send time). The agent reads other chats from the files themselves: `$INSTRUMENT_CHATS` opens this folder of every chat's records to it, read-only, and the `chat-history` system skill, loaded on demand, says what is in it (its `records.md` is generated from `records/records-guide.ts`, which is keyed by the record types). A task's history is read, never copied: its parent's messages up to `forkedAtMessageId`, then its own. What the log does not hold is read from it rather than kept beside it: what a session was last told of its folders, apps, memory, skills, processes and computer comes from its baseline's metadata and the notes since (`last-told.ts`), whether it has an app's guide from the hand-off a shell call in its window recorded, the app and a digest of the guide (`apps/guide-hand-off.ts`), where the window is the one the request is built from (`model-window.ts`), and what the chat's agent asked with `choose` and still waits on from its calls (`open-asks.ts`).

`session-of.ts` turns a folded session into the row shape every caller has always read: each `*At` is the moment its mark was made, and a stop holds until a message starts a turn after it.

## The index

`workspace.db`, on this computer, holds what the files say so the app does not refold every chat to draw a list: a value derived per session, kept under a stamp of its chat's files' sizes and modification times and derived again once they move, so a changed chat is folded whole (`workspace-index.ts`), and the index of every device's activity log of model requests, whose lines live in the workspace's `.instrument/devices/<device>/activity/<YYYY-MM>.jsonl`, one writer per file like the chat logs. Index tables are rebuildable and are dropped and rebuilt when their schema version moves. It also keeps where this device last left its newest log of each session (`own-log-cursors.ts`), which `openLog` checks the file against before appending: a log a sync engine or a restored backup put back as an older copy is left alone, and the device starts its next log.

## A chat's id, and `chat.db`

The chat id is how the routes, the window and the agent name a chat. A new one is the local date, up to 24 characters of the first message's words (`chat` when it has none), and four random Crockford base32 characters (`2026-10-19-fix-the-login-bug-7k3q`, `chat-folder-name.ts`), so two computers that have not synced yet do not both make the same chat; a suffix this computer already has is drawn again. Older ids end in the words or a `-N` counter, as do chats the 1.x migration makes, and stay valid. Its session ids are internal to its records; an address written before (`/chats/ses_…`, in an older reply or a memory) is opened at its chat through `chats.ofSession`.

`chat.db` was the SQLite store a chat was kept in before this. Nothing writes one now. What remains is the path in: `records/convert/read-chat-db.ts` reads one through a copy, with the store migrations and the interrupted-call sweep applied first, and `convert-chat.ts` writes its logs, settings and blobs, verifies the fold against the read field by field, and sets the database aside. A chat that differs stays on `chat.db`, is logged, and is retried at the next launch. The key-value table, `superjson` and the storage wrappers under that reader are all part of reading one, which is why they outlive the store itself.

`settings.json` was the file every device rewrote whole beside a chat's records. Nothing writes one now. At launch, after the database converter, `records/convert/convert-chat-settings.ts` carries what one holds (the model onto the chat's own session, the folder name and permissions into the machine folder, an earlier build's state into this device's state file) and removes it. A chat still on its `chat.db` keeps its file, which names the chat's session until its records do.

## Syncing

Nothing in the app syncs the folder: a sync engine (iCloud Drive, OneDrive, Dropbox) does, and the format is shaped so that it cannot lose a line by merging. `fake-sync.ts` stands in for one in the tests, delivering files late, partially, duplicated or evicted, and the property tests assert the same chat comes out either way. Real syncing between devices is validated last; see the plan's testing section.

While the app runs, `RecordArrivals` (`records/arrivals.ts`, started by Studio through `records/take-arrivals.ts`) notices what another device's files bring. It looks only at the chats folder: one recursive watch on macOS and Windows, where the system watches a tree with one handle; on Linux, the chats folder for chats coming and going plus a chat's own folder while its conversation is shown (`attendChatArrivals`). Every chat is also looked at when the window comes forward and every minute while it is in front, so a missed event is late rather than lost. A look stats each chat's files (never this device's own), reads only the bytes another device's file gained for the messages they name, then has `ChatRecords.catchUp` fold those bytes into the chat if it is held, and says the change on the record change feed as a write would. A held chat whose session took another device's records opens this device's log of it again before the next write, so the log that follows starts anew saying what it carries on from. An arrival never starts a turn.
