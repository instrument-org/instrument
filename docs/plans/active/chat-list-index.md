# Plan: a workspace index the chat list reads from

Status: proposed, not started. Stage A of the metadata index [conversation storage](conversation-storage.md) calls for, built as its option C: each chat and task keeps its own SQLite store as the source of truth, and one index per workspace is derived from them.

## Problem

Every chat-list build derives all 353 rows of a real workspace from their transcripts, at boot and again on every event in any chat. The other costs that used to compound it are fixed: task status and filed-task holds are cached against each task's store write count, bursts of events collapse into one rebuild per read, idle task databases close, and the list mounts only the rows in view ([dictated paste finding](../../findings/dictated-paste-lost-to-a-status-poll.md)). What remains is structural:

- Boot reads every chat's whole transcript before the first row can be drawn.
- A rebuild opens every chat's store to read its session record, so a busy workspace keeps hundreds of databases open while anything is moving.
- A row's derived fields (its latest line, its holds, its counts) live only in memory, so every process start pays for all of them again.

## Decisions already made

- **One `index.db` per workspace, at the workspace root.** Multiple workspaces are coming, and each carries its own index beside its `chats/` and `tasks/`.
- **Derived, never the source of truth.** Every row can be rebuilt from the per-chat and per-task folders. A corrupt or missing index is rebuilt, not repaired.
- **Versioned.** The index records the version of the row shape it was built with. A build whose version differs rebuilds it on boot, so changing what a row carries never needs a hand-written cache migration.
- **No digest in `settings.json`.** That file is the task's record, not a cache, and a digest there would need migrating every time the row shape moves.
- **Per-chat folders stay the unit a person manages.** Deleting a chat folder from outside the app leaves a stale row, which boot reconciles away against the folder listing.
- **Unread counts are dropped** from the row for now. A row can carry its finished-reply count and newest settled message id, so the count can return as a comparison against what was seen, without reading a transcript.

## Shape

Two tables and a version.

- **`chats`**: one row per chat. Columns for what is sorted, filtered or joined on (session id, chat task id, created and updated times, archived, starred, title, topics) and one JSON column for the rest of the row the list draws (latest line when settled, last ask, last reply time, reply count, newest settled message id, holds, the trimmed root message).
- **`tasks`**: one row per filed task: its id, the chat it was filed from, its title, and its settled standing.
- **`meta`**: the row-shape version and when the index was last reconciled.

What only memory knows stays out of the index and is laid over the row when the list is read: whether the chat's agent or a filed task is at work, the running tasks and their steps, holds on a task's start, and pending wakes. Those come from the workspace actor, as they do today.

## Write path

A row is recomputed from its store when that store has been written and has settled, never on every token. The seam already exists: every write to a task's store goes through the per-task storage handle in `session-store-storage.ts`, which counts writes per task. The index subscribes to the same events the live list does (`message.updated`, `part.updated` at tool-call starts, `session.*`, `task.updated`, `task.removed`, `chat.removed`), marks the affected rows dirty, and recomputes each dirty row once its task's write count has stopped moving. The mutations that change a session record (archive, star, rename, retitle, set topics, trash) update their row directly.

The row is computed by the code that computes it today: `chatFor` without its live overlay, and `standingAtRest` for a task. The index stores their output; it does not reimplement them.

## Read path

`listChats` and `chatById` read rows from the index and lay the live state over them. `chats.tasks` reads the `tasks` table the same way. `ChatSchema` and the routes do not change, so no client code changes. The server's other readers get the speedup with no change of their own: completion notifications, the chat list in the conversation's prompt (`chat-context.ts`), and the agent's `chat` command.

## Boot

1. Open `index.db`. If it is missing, unreadable, or its version differs, rebuild it: derive every row, the way a list build does today, once.
2. Otherwise reconcile: list the chat and task folders, drop rows whose folder is gone, and derive rows for folders the index has not seen (a chat migrated or copied in).
3. Serve the list from the index from then on.

The first boot after the index lands pays one full derivation, which is what every boot pays today.

## What it touches

Server: a new module that owns `index.db` (open, version, rebuild, reconcile, write path), `listChats` and `chatById` in `lib/orchestrator/chats.ts`, `childTasks` in `rpc/routes/chats.ts`, and the session-record mutations in `chats.ts`. Client: nothing.

## Out of scope: stage B

Paging and full-text search. Today the client holds every row and filters, searches and counts over them (`matchesFilters` and `hasWords` in `window/chats.ts`, the place and topic counts in `chat-pane.tsx` and `topic-banner.tsx`, the search fallback and topic backfill hooks, and three optimistic cache updates). Paging means moving those to queries over the index plus an FTS table, a page route and a counts route, and changing those eight client files. With the list virtualized, holding every row is cheap enough that this can wait until search needs full text. The agent's cross-chat search would read the same FTS table.

## Validation

Against a copy-on-write copy of a real workspace (`studio-chrome-devtools` skill, "Measuring the main thread"): time to the first row after boot, a rebuild after one chat changes, main-thread stalls under a burst of events with `main-stalls.mjs`, and open task databases while idle and while busy.

## Risks

- **A write that does not announce itself** leaves its row stale until the next reconcile. The per-task write count catches store writes that publish nothing (the browser's visited hosts are one), so the dirty check keys on it rather than on events alone.
- **Two processes on one workspace** (two dev instances sharing a data directory) would both write the index. SQLite's locking keeps the file sound; rows can still be recomputed twice, which is waste, not damage.
