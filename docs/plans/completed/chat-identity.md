# Plan: one identity for a chat

Status: completed. Steps 1 to 4 and 6 landed as written; step 5 landed for the workspace and `window.json` only (see Outcome).

## Problem

A chat is a task-shaped record with two ids. Its folder name is a `TaskId` and its folder a `TaskDir`, so the compiler cannot tell a chat from a task. RPC routes and `window.json` address it by its session id, so code translates between the two (`sessionOfChat` / `chatOfSession`, about 44 times) and branches on `isChatId()` (about 17 times). `recordDir` sends any id it does not know to `tasks/<id>` instead of failing, and the bash worker re-scans every chat's settings on every command. Each JSON file on disk has its own writer with different guarantees, and the 1.x conversion hand-encodes `task.db` rows.

## Steps

Each step is one commit that leaves types and the workspace and studio suites green.

1. **Brands and the resolver.** `ChatId` / `ChatDir` (zod brands refining `TaskId` / `TaskDir`, so a plain task id cannot stand for a chat). `resolveRecord(id)` in `record-folders.ts` answers a `RecordRef` (`{ kind: "chat", id }` or `{ kind: "task", id, chatId? }`) or `NotFound`; the index covers the tasks no chat owns too, verifies a miss against the disk, and keeps each chat's tasks so `chatTaskIds` is a lookup. `recordDir` throws `NotFound` for an unknown id. Callers branch on the ref instead of `isChatId`; `Task.parentTaskId` becomes `chatId: ChatId`. Checks: resolver tests (unknown id, chat, task in a chat, task no chat owns, the window), the suites, both packages' types.
2. **One JSON record writer.** `json-record-file.ts`: atomic temp + rename with the Windows retry, queued per path, unknown top-level fields carried forward, a file that cannot be read or parsed refused (or set aside, for `window.json`). Used by `task-record`, `window-state`, topics, and `writeJsonFileSync`'s callers (app manifests stay a whole-file replace by design). Checks: writer tests (unknown fields kept, unreadable refused, concurrent writes serialized), the existing record, window-state and topic tests.
3. **Migrations write rows through the store's own encoding.** `migrate-legacy-tasks.ts` builds keys with `StorageKey` and writes through one helper the store module owns (table, schema, superjson as TEXT). Checks: `migrate-legacy-tasks.test.ts`, `store-migrations.test.ts`.
4. **The bash worker gets its record.** The exec message carries the resolved `RecordRef` and folder; the worker's index holds only what it is handed and never scans. Checks: `bash-worker.test.ts`, the shell command suites.
5. **Chat id end to end.** `lib/chat/chats.ts`, the `chats.*` routes, and `window.json` (`chatSeen`, `appChats`) keyed by `ChatId`; `ChatSchema.id` is the chat id and the session id is a field the transcript reads. `window.json` entries keyed by session id are converted on read and rewritten on the next write. Session-row marks (`saveMark`) go through a per-chat queue. Studio's call sites follow through `RPCOutput`. Checks: conversion test, the suites, both packages' types.
6. **Docs.** `system-overview.md` and `packages/workspace/AGENTS.md` describe records as they stand; this plan moves to `completed/`.

## Outcome

Step 5 stopped short of the RPC surface. The window keys a chat's tab group, its `/chats/<id>` address, and its persisted tabs, compose entries and pane state by session id, and replies link chats as `instrument://chat/<session>`; the agent's `chat list` and chat context name chats the same way. Moving those to chat ids is a change to the window model (with a conversion of persisted renderer state and a reading of old links), which belongs with the tabs-and-history refactor rather than here. Until then `chats.*` take a session id and translate it once at the route.

## Constraints

- 1.x data keeps converting: `migrate-legacy-tasks.ts`, `migrate-workspace-layout.ts`, `migrateTaskState`, and store migration 1 keep their behavior.
- The empty "chat parts say chat" store migration keeps its slot.
- 2.0-beta-only shapes may change with an idempotent conversion; no compatibility shims beyond that.

## Out of scope

- The seven version mechanisms (`.layout-version`, the store migration count, the index key, `settingsVersion`, and the files with none). Step 2 gives the JSON files one writer, not one version.
- Making `ChatId` and `TaskId` disjoint. Record-generic code (the store, `taskDir`, the session machine, the RPC inputs chats and tasks share) takes `TaskId`, so a chat id stays assignable to it.
- Studio's persisted window state (tab groups, compose entries) if it turns out to be keyed by session id beyond what step 5 can convert; that is reported rather than guessed.
- The change feed and `listChats` payload work in [chat-list-payload-and-parentage.md](chat-list-payload-and-parentage.md), beyond the per-chat task lookup step 1 needs.
