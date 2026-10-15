
# A part the store took is not a record yet

**Status:** closed 2026-10-15. Fixed first in `llm-request.ts`, then closed for every reader by the write gate: a chat is written through `ChatWrites`, which waits for each append, so there is no window in which a part has been taken and is not in the records. See "How it was closed" below.

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

## How it was closed

The window was a property of writing in two places: the store took the part, and the records were told afterwards by something nobody waited on. With the store gone there is one door, `ChatWrites`, and every function on it waits for its append, so a write that has resolved is a write a read will find.

A part still arriving never reaches a log at all now: `ChatWrites.savePart` puts it in the turn's memory, and the snapshot that settles it goes through `ChatRecords.live.settle`, which was built for exactly this and had been used only in a test. `settle` holds the pending write before it drops the memory copy, so the part is in one of the two at every moment. `llm-request` no longer waits for a queue on its way out, because there is nothing of its own left in flight.

What remains true is the shape of the trap rather than the trap: a write nobody waits on is a message the person sent and the chat does not have, which is why nothing on the write side is fire-and-forget any more.
