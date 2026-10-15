
# A part the store took is not a record yet

**Status:** fixed 2026-10-15 in `llm-request.ts`. The gap it describes is still open for readers other than the turn; see "What is still true" below.

A chat's records are appended through a per-chat write queue (`StoreRecords.append`), and nothing waits on an append: `Store.savePart` resolves when the store has the part, and calls `StoreRecords.part` without awaiting it. So for as long as the chat's queue is, a part the store has taken is in the records not yet.

The turn's own memory (`ChatRecords.live`) is what covers that gap, and the turn dropped it too early. `llmRequestLogic` ended with:

```ts
live?.clear();
return { message: assistantMessage, parts: await getCurrentParts() };
```

`getCurrentParts` reads the transcript back through `ChatReads`, which for a chat whose records are held reads the fold, the writes pending over it, and the turn's live memory. With live cleared and the append still queued, the part is in none of the three.

The part that is reliably still queued is the last one the reply settled, and the last thing a reply settles is its tool call. So the parts handed back to the agent machine had no tool call in them, `toolCallQueue` came back empty, and `MaybeExecutingToolCalls` fell through to `Finishing`. The turn ended with the call at `input-available`, no error, no stop, nothing in the log.

## What it looked like

GLM 5.3 Flash, `chat-loads-a-typed-skill` and `chat-loads-a-mentioned-skill`, on the records branch: four sessions of four died at tool call 1, step 1. The same two cases on `main` ran six to ten steps to a clean finish, four of four. Rate limiting was ruled out separately: the branch failures carried no API error at all, and reducing the run from seven concurrent tasks to two changed nothing.

The probe that settled it, printed either side of the read:

```
PROBE StoreRecords.part tool-load_skill input-available arriving=false records=true
PROBE setPart a574 … tool-load_skill input-available liveSessions=1 parts=1
PROBE read() a574 … liveMapSize=0 chatLive=undefined
  folded: [… 48JZ[step-start,reasoning:done,text:done] …]  live: []  pending: [text:done]
PROBE parts ["step-start:-","reasoning:done","text:done"]
```

One `ChatRecords` instance, one chat id: the part goes into live, live is empty a moment later, the fold does not have it yet, and the read comes back without it. The fold picks it up two reads later.

A fast model makes this reliable rather than rare, because its tool call settles close enough to the end of the stream that the append is always still queued.

## Why nothing caught it

- The unit suites do not exercise the queue's timing: a test that writes and reads awaits the append, or installs no records at all.
- The eval harness scored it as a pass with failed assertions. An assertion that a `load_skill` call was made passes on a call that never ran, and `summary.json` said `erroredTasks: 0`. That is fixed separately (`unfinishedCalls` in `evals/report.ts`): a call still open once a run is over, with no stop recorded, now counts as a run that failed.
- Nothing in the logs. No API error, no `stoppedBy`, no exception. The turn looked like a model that answered and stopped.

## The fix

```ts
await StoreRecords.landed(input.chatId);
live?.clear();
```

`landed` awaits the chat's current queue tail. A chat's appends go in order, so the one queued last standing means every earlier one is standing. It does not loop over the tail, so a task still writing to the same chat cannot hold up its parent's reply.

## What is still true

Between `Store.savePart` resolving and the append landing, a part is visible only through the turn's live memory, and `StoreRecords.part` takes it out of live (`forget`) before queuing the append rather than when the append lands. Any reader in that window sees neither. For the renderer that means a tool call drawn a moment late, which is why this was never noticed.

`ChatRecords.live` already has the primitive for doing it in the right order — `settle`, "takes a part out of the turn's memory and appends it as settled", which holds the pending write before dropping the memory copy. It is used in one test and nowhere in production. Wiring `StoreRecords.part` to it closes the window for every reader; measured on its own it does not fix the turn, because `live?.clear()` was wiping the memory copy regardless, so it was left out of the fix rather than carried as an unmeasured change.
