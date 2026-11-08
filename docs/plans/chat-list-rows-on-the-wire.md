# Plan: send the chat list as rows that changed

Status: open. Steps 1 and 2 landed: a row's digest is read from written records, re-reads for changes only in memory are held to one per chat per 500 ms, and one reading of the list per process serves every follower (`liveChatList`). Takes up the step [record-change-feed.md](record-change-feed.md) left under "Next" and [chat-list-payload-and-parentage.md](chat-list-payload-and-parentage.md) closed without.

## Problem

`chats.live.list` re-reads only the rows a change moved, but sends the whole `Chat[]` every time, to every window, and the phone file runs a copy of its own. Measured on a copy-on-write copy of a 424-chat workspace: one list is 405 KB; starring one chat sends it twice (the forced answer from `dd4182bb7`); one three-minute agent turn sent it 67 times, 27 MB, 97% of what the renderer received.

Most of those sends come from the running turn. A row's digest (`chatDigest`, `lib/chat/chats.ts`) reads `ChatReads.transcript`, which merges the turn's in-memory parts (`liveView`), and those publish on the record change feed every 100 ms per session (`LIVE_PUBLISH_MS`, `lib/records/chat-records.ts`). So a reply streaming in moves its chat's row (`latest` grows), though the list shows a working chat only by its step. The same digest is kept in `workspace.db` under a stamp in-memory parts never move, so a crash mid-reply can leave a row showing words that were never written.

Optimistic paints (star, archive, unread, project, delete) are written into the one query cache each whole-list answer replaces, so an answer computed before the write undoes the paint until the forced answer lands. Seven row fields have no reader in the list UI (`lastAsk`, `lastReplyAt`, `lastStep`, `ownStep`, `runningTasks`, `ownWorking`, `titled`).

## Steps

Each lands on its own, and the list stays correct after each.

1. **A row is read from written records.** `ChatReads.transcript` takes an option that leaves out `liveView`, and `chatDigest` uses it; `lastStep` leaves the digest; `INDEX_VERSION` goes up. The step a running turn or task is on keeps coming from its live reads (`ownStep`, `chatActivity`), with re-reads for changes that are only in memory held to one per chat per 500 ms. Tests: a streaming reply sends no list answer; a digest read mid-stream is not kept in the index; the existing step-while-arriving test still passes.
2. **One list per process.** A chat list store in `lib/chat/` owns what each `liveChatList` keeps today and reads moved rows once; the route and the phone file subscribe to it. Same wire. Tests: the live list block in `chats.test.ts` unchanged against the store, plus two subscribers reading a moved row once.
3. **Patches on the wire.** `chats.live.rows` sends a snapshot, then patches of upserted rows and removed ids, each with the process's `epoch` and a revision. The client folds them into the one query (`chatListOptions()`) and refetches when the epoch changes or a revision is skipped. `chats.live.list` goes. Tests: the test helper folds events so the existing assertions stand; a patch carries only the moved row; a Studio test of the fold (snapshot, upsert, removal, gap); a budget test that what one change sends does not grow with the number of chats.
4. **Paints as an overlay.** A row-changing route (`whenChat`) returns the `{ epoch, rev }` its row stands at. Paints live in a per-window overlay merged into what readers see, dropped when the request fails or the cache reaches that revision. `chatRowAsked`, the forced answer, the cache paints and the rename field's 250 ms waits go.
5. **A wire row of its own.** `ChatRow` is what the route sends, separate from the store's internal `Chat`. The fields with no reader leave the wire; `sessionId` readers use `chats.session` and `chats.ofSession`; `updatedAt` readers use `lastUserMessageAt`. `firstAsk` and `holds` stay, for search, with an outlier cap.
6. **Readers select.** The window shell (`app-window.tsx`) and the tab strip select what they draw from the list rather than re-rendering on every answer; the shell's maps become plain objects so structural sharing keeps them.

## Out of scope

The phone's `chat-list.json` keeps its fields and format: its renames since format 1 wait on the phone app's owner. Moving search to the server: `firstAsk` averages about 225 bytes a row, so patches already make it cheap.
