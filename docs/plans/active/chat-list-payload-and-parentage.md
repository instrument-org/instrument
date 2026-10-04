# Plan: a cheaper chat list rebuild

Status: accepted, not started. Follows [chat-list-index.md](../completed/chat-list-index.md), which deferred both changes below: stage A kept `ChatSchema` unchanged so no client code moved, and the per-chat task scan was expected to go once the index held parentage, which it does not.

## Problem

Measured against a copy-on-write copy of a dev workspace of 762 chats and 756 filed tasks, with the index warm:

| Step | Time |
| --- | --- |
| Chat folder scan (`read()` in `record-folders.ts`) | 151 ms |
| First `listChats` | 500 to 630 ms |
| Every later `listChats` | about 270 ms |
| Payload of each `listChats` | 2.1 MB |

The live list (`liveListChatsRoute` in `rpc/routes/chats.ts`) calls `listChats` again on every change in any chat and sends the whole array, so both costs recur while anything is moving, not only at boot. Reading every digest from the index and parsing it is about 25 ms of the 270; the index is doing its job.

1. **Finding a chat's tasks is quadratic.** `chatTaskIds` (`lib/record-folders.ts`) spreads the whole task map and checks every task's folder against the chat's, once per chat: 762 × 756 per build. A CPU profile puts about 260 of the 270 ms here.
2. **Each row carries its chat's whole first message.** `ChatSchema.root` (and `ChatDigest.root`, which the index stores) is the first user message with every part. It is 1.6 of the 2.1 MB. Its text is 70 KB; the rest is data parts nothing on a row reads: `data-memory` 720 KB, `data-chatContext` 263 KB, `data-adoptedTask` 209 KB, smaller ones after. The server reads `root` only for the row's `createdAt` and the untitled-title fallback (`chatFor` in `lib/chat/chats.ts`); the client reads only its text, through `askOf` (`window/chats.ts`).

## Changes

### Tasks by chat, kept by the folder index

`read()` in `lib/record-folders.ts` already walks `chats/<id>/tasks/` for each chat. It fills a `Map<TaskId, TaskId[]>` from chat to its tasks in the same loop, and `chatTaskIds` becomes a lookup in it. Everything that adds or drops a task or chat from the folder index (`placeChatTask`, `forgetChat`, and any other writer of `tasks`) keeps the map in step. `record-folders` stays the one place that knows which task is in which chat.

No schema, index or client change.

Done as part of [chat-identity.md](../completed/chat-identity.md): the index keeps each chat's tasks, and `chatTaskIds` is a lookup.

### The first ask as text

- `ChatDigest.root?: SessionMessage.UserWithParts` becomes `firstAsk: string` (the first user message's text parts joined, as `askOf` does today) and `firstAskedAt?: Date` (that message's `createdAt`). `chatFor` takes `createdAt` from `firstAskedAt` and the untitled title from `firstAsk`.
- `ChatSchema.root` becomes `firstAsk: string`, paired with the existing `lastAsk`.
- `askOf` is retired: its callers (`matchesSearch` in `window/chats.ts`, `use-topic-backfill.ts`, `use-chat-search-fallback.ts`) read `chat.firstAsk`. The fixtures in `chats.test.ts` and `chat-row.browser.test.tsx` follow.
- `INDEX_VERSION` in `lib/workspace-index.ts` goes from 1 to 2, so every stored digest is derived again once, as [chat-list-index.md](../completed/chat-list-index.md) says a change of shape is handled.

Expected: about 0.5 MB per rebuild, and stored digests shrink by about the same share.

## Out of scope

- **Paging** (stage B of the index plan). Filters, search and counts run in the renderer over every row, and with both changes in, a full rebuild is tens of milliseconds and half a megabyte. Paging stays deferred until search needs full text.
- **Showing the last list while the first rebuild runs.** Worth it only if boot still feels slow once these land and a trace of Studio's startup says where the rest goes; the server side here was under a second even cold.

## Order

1. Tasks by chat, with a test in `record-folders.test.ts` that a task placed or forgotten moves the lookup.
2. The first ask as text and the index version, server then client, in one commit since `ChatSchema` moves under both.

Re-verify the file references above against main first: `record-folders.ts` and `lib/chat/` move often.

## Validation

- Time `listChats` against a copy-on-write copy of a real workspace (`cp -c -Rp` of the dev workspace and its `indexes/` file, renamed to the hash of the copy's root) before and after, warm and cold. Expect the warm rebuild near 20 ms and the payload near 0.5 MB.
- The chat list matches the build before, field for field, apart from `root` becoming `firstAsk`.
- One dev boot: rows draw, an untitled chat shows its first words, and search finds a chat by words that are only in its first message.
