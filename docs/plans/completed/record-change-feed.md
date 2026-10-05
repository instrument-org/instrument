# Plan: one change feed for records

Status: completed. Steps 1 to 6 landed; the per-row wire format is the next step below.

## Problem

Live views learn that something changed from lists of events kept by hand. About 30 sites publish by hand (`task.updated` after a settings write that already published it, `task.stateUpdated` after every state write, `session.updated` for a seen mark), and each live route merges its own list: `chatChanges` eight sources under a fifteen-line comment, `childTaskChanges` seven topics plus message batches plus a part filter that listens to every task in the workspace. A row field whose source is not on a list goes stale, which is how f70745055 (a deleted chat kept its row), f35967ae8 (a row said working after the turn ended) and 0a89e81ee (app changes did not move rows) happened. Each change in any chat rebuilds the whole chat list (about 270 ms on a real workspace, per [chat-list-payload-and-parentage.md](chat-list-payload-and-parentage.md)).

One task's standing (working, held, step, newest session) is answered by five routes, three of them polled every two seconds by the renderer (`task-working.ts`, `newest-session.ts`, `created-task-card.tsx`). Studio main imports `workspacePublisher` and publishes `app.updated` plus `app.event` in hand-kept pairs at about twenty sites, which is the coupling [agent-turn-off-the-main-thread.md](agent-turn-off-the-main-thread.md) has to cut.

## Steps

Each step is one commit that keeps both packages' types and suites green.

1. **The feed.** `record.changed { id, kind }` with `kind` one of `messages`, `session`, `settings`, `state`, `agent`, `removed` (a removal carries the `RecordRef`, since the index has forgotten the record by then). Emitted by the store's write layer (every write through a task's storage handle, classified by key), by the task record writer (`updateTaskSettings` is `settings`, `setTaskState` is `state`), by the session actor (added, tags changed, done) and the hold registry (`agent`), and by deleting a chat. `recordChanges(signal)` hands a consumer every change since it last pulled, as one batch, with nothing dropped. Checks: a store write emits once with its kind, a session tag change emits `agent`, a burst arrives as one batch.
2. **Chat routes on the feed.** `chats.live.list` and `chats.live.tasks` listen to the feed (plus `app.updated`, since a row's holds name the workspace's apps) and nothing else. The list keeps its rows and recomputes only the chats a batch moved, the chat a task belongs to included; a removed chat leaves at once. The hand-kept topics with no payload consumer go (`task.updated`, `task.stateUpdated`, `task.removed`, `chat.removed`, `session.added`, `session.tagsChanged`, `session.updated`, `session.removed`), with the hand publishes after writes the feed already reports, and the remaining consumers (`task.live.byId`, `task.live.activity`, the CDP bridge, the chat list's caches) move to the feed. `message.*`/`part.updated` stay (transcripts batch by message id), and so does `session.done` (wake, retitle, notifications read its session). Checks: list freshness for a deleted chat, a turn ending, an app change, a rename and a star.
3. **One status route.** `task.status` / `task.live.status`: working, held reason, current step, newest session, title. The step is read from the newest messages backward rather than the whole transcript. `chats.taskStatus` goes, and the three polls become one live query. Checks: route test (hold, working, step, newest session), the Studio suite.
4. **`appChanged(slug, event?)`** in the workspace publishes `app.updated` and, given an event, `app.event` with the app's name. Studio calls it instead of the pairs; `apps.notifyChanged` on `WorkspaceConfig` goes, since the workspace publishes itself.
5. **The bus behind a port.** The workspace exports `appChanged`, `appListChanges(signal)` and `sessionEnds(signal)` and stops exporting its publisher, so no Studio file can import it. Checks: Studio types, the suites.
6. **Docs.** `system-overview.md` says how the UI learns of changes; this plan moves to `completed/`.

## Checks at the end

Both full suites; both packages' types; a fixture booted from this worktree with `studio-drive`, renaming and starring a chat over RPC and seeing its row move, `sweep-screens.mjs` clean.

## Outcome

Beyond the plan: trashing one task with the `task` command now reaches listeners (no topic said so before); the running-task step is read from the newest message back rather than the whole transcript; `task.agentStatus.byIds` went with `chats.taskStatus`, and `studio-drive wait --idle` polls `task.status`. In a fixture booted from this branch, a rename and a star sent over RPC reached the chat row in about 100 ms (the poll interval of the check), and `sweep-screens.mjs` was clean. Main-thread stalls were not measured.

## Next, not in this plan

- **Rows on the wire.** Step 2 recomputes only the moved rows but still sends the whole array, so the payload cost (2.1 MB, most of it `root`) stays until the list sends upserts and removals by chat id and the client folds them into its cache. That is a protocol change for `chat-list-query.ts` and every reader of the list, best done with the `firstAsk` change in [chat-list-payload-and-parentage.md](chat-list-payload-and-parentage.md).
- **Transcript patches** ([incremental-live-transcript-updates.md](incremental-live-transcript-updates.md)): the feed says which record moved; the transcript still needs which message and how.

## Out of scope

Moving the agent off the main thread; the files namespace (`computer.*` vs `files.*`); Studio's own publisher, which carries window and browser commands rather than record changes.
