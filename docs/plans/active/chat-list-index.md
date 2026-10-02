# Plan: a workspace index the chat list reads from

Status: stage A implemented, not merged. Stage A of the metadata index [conversation storage](conversation-storage.md) calls for, built as its option C: each chat and task keeps its own SQLite store as the source of truth, and one index per workspace is derived from them and kept in the app's data folder (`indexes/`, named by a hash of the workspace root).

## Problem

Every chat-list build derives all 353 rows of a real workspace from their transcripts, at boot and again on every event in any chat. The other costs that used to compound it are fixed: task status and filed-task holds are cached against each task's store write count, bursts of events collapse into one rebuild per read, idle task databases close, and the list mounts only the rows in view ([dictated paste finding](../../findings/dictated-paste-lost-to-a-status-poll.md)). What remains is structural:

- Boot reads a whole transcript 1,124 times on a workspace of 353 chats and 388 filed tasks before the first chat row is drawn: once per filed task for its standing (388), once per chat for its row (356), once per chat for the Files screen's recents (356, through `linkedFiles`), and a few for running steps. Main is busy for about 92% of the 6.5 s that takes, so input lags for the first seconds after every launch.
- A rebuild opens every chat's store to read its session record, so a busy workspace keeps hundreds of databases open while anything is moving.
- A row's derived fields (its latest line, its holds, its counts) live only in memory, so every process start pays for all of them again.

## Decisions already made

- **One index per workspace, in the app's data folder, keyed by the workspace's id.** Multiple workspaces are coming, and some will be folders a person chose, inside iCloud Drive or another synced folder. A SQLite file and its write-ahead log in a synced folder invite conflict copies and corruption, and a derived file has no reason to travel with the workspace: a desktop notes app whose vaults commonly live in iCloud keeps its parse cache in its own application data, keyed by vault id, for the same reasons. A workspace opened on a second machine rebuilds its index there.
- **Derived, never the source of truth.** Every row can be rebuilt from the per-chat and per-task folders. A corrupt or missing index is rebuilt, not repaired.
- **Versioned.** The index records the version it was built under: `INDEX_VERSION`, the app's version, and the stores' migration count. Any difference throws it away and rebuilds it as it is read, so a release, a store migration, or a change to a row's shape never needs a hand-written cache migration. `INDEX_VERSION` is bumped by hand when a derivation changes what it returns within one release.
- **Only ever a speed-up.** A row that cannot be read or saved (another process holding a lock, a full disk) is derived as though absent, and a value read around a failure (a store that would not open) is answered but kept nowhere, so a failure is never served again.
- **No digest in `settings.json`.** That file is the task's record, not a cache, and a digest there would need migrating every time the row shape moves.
- **Per-chat folders stay the unit a person manages.** Deleting a chat folder from outside the app leaves a row nothing reads again; nothing prunes such rows yet.
- **A file's stats decide whether its row is current.** Each row records the size and modification time of its store (`task.db` and its `-wal`) when it was derived. Boot compares them with a stat of each store and re-derives only rows whose store moved, which also catches a store written while the app was not running.
- **Unread counts stay** without reading a transcript: the digest carries the ids of the messages that count, and the row compares them with what the user has seen.

## Shape

One table per derived value, each row keyed by the chat's or task's id and carrying the value (superjson) and the stamp of the store it was derived from, plus a `meta` table holding the version:

- **`chat_digests`**: what a chat's row is made from that its own store holds: its session record and what its messages say, boiled down to what the row reads (`ChatDigest` in `lib/orchestrator/chats.ts`).
- **`task_standings`**: a filed task's standing when no agent is at work on it.
- **`task_apps`** and **`task_hosts`**: a filed task's apps (from its settings, so their stamp includes `settings.json`) and the hosts its browser visited, which a chat's holds gather.
- **`linked_files`**: the files each chat's replies put on screen, which the Files screen's recents reads instead of every chat's transcript.

Stage A reads rows by id and never queries across them, so no field is promoted to a column yet. Stage B promotes what its queries filter and sort on, which is a version bump and a rebuild rather than a migration.

What only memory knows stays out of the index and is laid over the row when the list is read: whether the chat's agent or a filed task is at work, the running tasks and their steps, holds on a task's start, pending wakes, what the user has seen, and whether a turn is starting by the clock. Those come from the workspace actor, as they do today.

## Read through, not written ahead

A value is looked up when it is read (`indexedByStore` in `lib/workspace-index.ts`), in three steps:

1. In memory, by the task store's write count, which every write in this process moves.
2. In the index, by stamp: the size and modification time of the store (`task.db` and its `-wal`) and of any other file the value reads, taken before the value is derived. A row whose stamp matches is used.
3. Otherwise derived from the store, as before the index, and written to the index with its stamp.

Nothing subscribes to events to keep rows current and nothing marks rows dirty: a write moves the stamp, and the next read derives the row again. A write landing while a value is derived leaves the saved stamp older than the store, which costs one more derivation and never serves a stale row. The derivations are the code that ran before the index (`digestOf` from `chatFor`, `standingAtRest`, the filed-task holds, `shownIn`); the index stores their output and does not reimplement them.

## Read path

`listChats` and `chatById` read rows from the index and lay the live state over them. `chats.tasks` reads each filed task's standing from `task_standings` and its chat's title from that chat's digest. `ChatSchema` and the routes do not change, so no client code changes. The server's other readers get the speedup with no change of their own: completion notifications, the chat list in the conversation's prompt (`chat-context.ts`), and the agent's `chat` command.

## Boot

There is no separate boot pass. The first list build reads every row through the index: unchanged stores answer from their rows, changed or new ones are derived and saved. A missing index, one that will not open, or one of another version is rebuilt the same way, by being read. Rows for chats or tasks that are gone are never read again; nothing prunes them yet.

## What it touches

Server: `lib/workspace-index.ts` (open, version, rebuild, read through), `chatFor` split into `digestOf` and the overlay in `lib/orchestrator/chats.ts`, `standingAtRest` in `standing.ts`, `shownIn` in `linked-files.ts`, and filed tasks' chat titles in `rpc/routes/chats.ts`. Studio main passes `indexesDir` under its data folder to the workspace actor. Client: nothing.

## Out of scope: stage B

Paging and full-text search. Today the client holds every row and filters, searches and counts over them (`matchesFilters` and `hasWords` in `window/chats.ts`, the place and topic counts in `chat-pane.tsx` and `topic-banner.tsx`, the search fallback and topic backfill hooks, and three optimistic cache updates). Paging means moving those to queries over the index plus an FTS table, a page route and a counts route, and changing those eight client files. With the list virtualized, holding every row is cheap enough that this can wait until search needs full text. The agent's cross-chat search would read the same FTS table.

## Validation

Against a copy-on-write copy of a real workspace of 353 chats and 388 filed tasks (`studio-chrome-devtools` skill, "Measuring the main thread"), in a dev build:

- The chat list, the filed tasks and the Files screen's recents came back byte-identical to the build before the index, with the index cold and warm.
- A warm boot read no transcripts (1,124 before), counted with a logpoint on `Store.getMessagesWithParts` that a deliberate read afterward did trip.
- The first chat row came 1.5 s after the list's skeleton (about 7 s before), with 72 task databases open (741).
- After writing one chat's store with the app closed, the next boot re-derived that chat alone.
- A star and a rename show in the row at once.

What is left between skeleton and rows is reading every filed task's `settings.json` to list them, and the renderer drawing the list; a packaged build on a second machine gives the boot time without the dev server's module loading in it.

## Risks

- **A write the stamp cannot see.** Every write this process makes moves the store's write count, and every write moves the file's modification time, so neither a write that announces nothing (the browser's visited hosts) nor one made while the app was closed is missed.
- **Two processes on one workspace** (two dev instances sharing a data directory) both use the index. A save that meets the other's lock is skipped and derived again next time; the file is deleted only when SQLite reports it is not a readable database, never because it is busy. Dev worktrees of the same app version and `INDEX_VERSION` share rows, so one whose derivations differ should bump it.
- **Stats that do not move.** A store rewritten within the clock's resolution with the same size would read as unchanged. Writes in this process are caught by the write count; the stats only stand in for writes made while it was not running, where that collision is not a practical concern.
