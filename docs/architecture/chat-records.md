# Chat records

A chat is a folder of append-only files, one per session per device, and nothing else. Every read of a chat is a view over those files; every write appends to them. There is no database holding a chat's messages: `workspace.db` is an index of what the files already say, rebuildable by reading them again.

This is the map. [The plan](../plans/active/chat-records.md) carries the record spec and the reasoning behind the format.

## The files

In the chat's record folder (`chats/<id>/`, resolved by `record-folders.ts`):

| Name | What it holds |
|---|---|
| `<session>.<device>.jsonl` | One session's log, as that device wrote it: its header, its messages and parts, where its context window was reset, who stopped its turn, what it was told |
| `marks.<device>.jsonl` | What the person did to the chat from that device: title, star, archive, unread, topics, Stop |
| `blobs/sha256-<hex>.<ext>` | The bytes a part points at, named by their hash, so the same bytes get the same name on every device |
| `settings.json` | What the app knows about the chat: the model and effort its sessions run on, the folders granted in it |

A record is one JSON object on one line, `t`, `seq` and `at` first (`records/record.ts`). A device only ever appends to files that carry its own id, so two devices writing the same chat never write the same file, and a sync engine has nothing to merge. The conflict copies it makes anyway (`file-names.ts` knows their shapes) are read like any other file.

## Writing

`ChatWrites` (`lib/chat-writes.ts`) is the only way a chat is written, and every function on it waits for its append. A write nobody waits on is a message the person sent and the chat does not have.

Under it, `ChatRecords` (`records/chat-records.ts`) owns this device's files while the workspace is open: one service per process, on the main thread, installed at workspace open and disposed at quit. It holds each open chat's fold, a queue per file so lines never interleave, and the running turn's memory. `record-writer.ts` gives each record its `seq`; `open-log.ts` opens a handle for a burst and closes it after, because a sync engine will not sync a file an app holds open; `sync-directory.ts` makes a folder's names durable where the filesystem needs asking.

A part still arriving is never a record: text or reasoning being streamed, a call whose input is still being typed, and the preliminary output a tool gave before its own (`records/arriving.ts` is the one definition). Those live in the turn's memory, where every read of the chat sees them, and the snapshot that settles one is what gets written. So a reply's text is written once, whole, however many deltas it arrived in, and a reply cut off mid-stream leaves nothing behind.

A tool's returned bytes go to a blob and the part keeps the blob's name, media type and size (`part-blobs.ts`), so a log stays text and the same image returned twice is stored once.

## Reading

`ChatReads` (`lib/chat-reads.ts`) answers every read, from one `ChatRead`: the fold, the writes still on their way to disk over it, and the running turn beside them. A process with no records in place holds no chat at all and is told so rather than left to assume.

`fold.ts` reads every log and marks file in the folder into sessions, their messages and parts. Folding is order-independent: any file order, duplicates, truncations or conflict copies give the same chat. `read-records.ts` takes a record only from a line that ends in `\n`, parses, and carries a larger `seq` than the one before it; everything else is counted and skipped, which is what makes a crash mid-append a skipped line rather than a broken chat.

The views (`records/views.ts`) are what callers actually use: `list` (the chat list and header), `conversation` (what the chat view draws), `steps` (tool calls, reasoning and the developer-only parts), `live` (the running turn, memory only), and `modelHistory` (what a request is built from, blobs read back at send time). The agent reads other chats from the files themselves: `$INSTRUMENT_CHATS` opens this folder of every chat's records to it, read-only, and the `chat-history` system skill, loaded on demand, says what is in it (its `records.md` is generated from `records/records-guide.ts`, which is keyed by the record types). A task's history is read, never copied: its parent's messages up to `forkedAtMessageId`, then its own.

`session-of.ts` turns a folded session into the row shape every caller has always read: each `*At` is the moment its mark was made, and a stop holds until a message starts a turn after it.

## The index

`workspace.db`, on this computer, holds what the files say so the app does not refold every chat to draw a list: per-file cursors, the chats, sessions and messages tables, and the activity log of model requests, which exists only there. Index tables are rebuildable and are dropped and refolded when their schema version moves (`records-index.ts`, `workspace-index.ts`).

## A chat's id, and `chat.db`

The chat id is how the routes, the window and the agent name a chat. Its session ids are internal to its records; an address written before (`/chats/ses_…`, in an older reply or a memory) is opened at its chat through `chats.ofSession`.

`chat.db` was the SQLite store a chat was kept in before this. Nothing writes one now. What remains is the path in: `records/convert/read-chat-db.ts` reads one through a copy, with the store migrations and the interrupted-call sweep applied first, and `convert-chat.ts` writes its logs, marks and blobs, verifies the fold against the read field by field, and sets the database aside. A chat that differs stays on `chat.db`, is logged, and is retried at the next launch. The key-value table, `superjson` and the storage wrappers under that reader are all part of reading one, which is why they outlive the store itself.

## Syncing

Nothing in the app syncs the folder: a sync engine (iCloud Drive, OneDrive, Dropbox) does, and the format is shaped so that it cannot lose a line by merging. `fake-sync.ts` stands in for one in the tests, delivering files late, partially, duplicated or evicted, and the property tests assert the same chat comes out either way. Real syncing between devices is validated last; see the plan's testing section.

While the app runs, `RecordArrivals` (`records/arrivals.ts`, started by Studio through `records/take-arrivals.ts`) notices what another device's files bring. It looks only at the chats folder: one recursive watch on macOS and Windows, where the system watches a tree with one handle; on Linux, the chats folder for chats coming and going plus a chat's own folder while its conversation is shown (`attendChatArrivals`). Every chat is also looked at when the window comes forward and every minute while it is in front, so a missed event is late rather than lost. A look stats each chat's files (never this device's own), reads only the bytes another device's file gained for the messages they name, then has `ChatRecords.catchUp` fold those bytes into the chat if it is held, and says the change on the record change feed as a write would. A held chat whose session took another device's records opens this device's log of it again before the next write, so the log that follows starts anew saying what it carries on from. An arrival never starts a turn.
