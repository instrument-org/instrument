# A dictated paste lands the old clipboard, because a status poll holds the main thread

**Status:** fixed in 4962c9595, 16fb93fab and f9413ee76; checked 2026-10-02. Measured on 2026-09-30 against 103 filed tasks and on 2026-10-01 against a copy of a real workspace of 353 chats and 388 filed tasks after the 1.x migration, then fixed and re-measured on that copy the same day. The cause and the measurements below are the record; the fix is at the end.

Dictation tools that insert text by pasting (Handy is the one this was found with) sometimes put the user's previous clipboard into the composer instead of what they just said. Other apps on the same machine do not. The cause is not our paste handling and not the agent's turn: it is a two-second poll whose every answer reads the whole message history of every task the window has filed.

## How a paste-based dictation tool inserts text

With its clipboard setting on "don't modify", the tool saves the clipboard, writes the transcript to it, waits a short delay (60 ms by default), sends Cmd+V, waits a second short delay (60 ms by default), and puts the saved clipboard back. The app has one window to read the clipboard: from the keystroke to the restore. An app that reads it later reads the old contents, which is exactly the symptom.

## Why Electron's main thread is on the path twice

The keystroke reaches the page through the browser process's UI thread, which in Electron is the thread main-process JavaScript runs on. Then the page's paste reads the clipboard with a synchronous call answered by that same thread. Measured with the simulator below, a paste on an idle main thread takes about 20 ms from the key being posted to the paste handler running, so a 60 ms restore leaves about 40 ms of slack. With a 25 ms restore, one paste in six is lost even on a quiet thread: the floor is real, and main stalls spend the slack.

Both halves were seen separately. In one lost paste the keystroke reached the page in 22 ms and the paste event still fired at 262 ms, waiting on the clipboard read while main was busy.

`KeyboardEvent.timeStamp` does not measure this. In Electron it is when the renderer received the event, not the OS event time, so a probe that subtracts it from the handler's time reads a few milliseconds while the paste is losing the race. The delay has to be measured from outside the app.

## What holds the main thread

The app window polls `workspace.chats.tasks` every two seconds (`REFRESH_MS` in `app-window.tsx`, `chat-tasks-view.tsx`, and three others). For every task the window has filed, the route computes `taskStanding`, and on the common path that is `pendingAsk`, then `lastAssistantText`, then sometimes `endedWithoutWords`, each of which calls `Store.getMessagesWithParts` and reads, parses, and validates the task's whole transcript. With 103 tasks that is one to two seconds of work per call, in small interleaved slices, repeated every two seconds. The window reads only each task's title and chat from the answer; the standing is used by the tasks screen and the created-task card.

A CPU profile of main with no turn running spent about a third of wall time in `getItemRaw`, `getKeys`, superjson `deserialize`, and zod parsing under `getMessagesWithParts`. A logpoint there counted 574 calls in ten seconds, every one of them from `taskStanding` under that route's handler.

The renderer pays too: each poll's answer costs an 80 ms TanStack Query timer task, and long animation frames up to 285 ms appeared only with the poll running.

`listChats` has the same shape: `chatFor` reads every chat's whole transcript, and `liveListChatsRoute` re-runs it on every change in any chat. It did not produce stalls in these runs, but it grows the same way.

## At the scale a migrated workspace reaches

The route is `workspace.chats.tasks` now, still polled every two seconds by the app window. Against a copy of a workspace the 1.x migration grew to 353 chats and 388 filed tasks:

- One `chats.tasks` call takes about 5 seconds, so a visible window keeps main busy almost without pause.
- Calling it on the window's cadence for 20 seconds put main's event-loop delay at p99 239 ms and max 806 ms, with 56 stalls over 60 ms, about three a second. At that rate nearly every dictated paste loses.
- `chats.list` over the same 353 chats takes about 200 ms warm, but called every half second it caused no stall over 30 ms: its work is interleaved awaits, so on main it costs latency rather than blocking. Its cost to the renderer, which draws every row, was not measured here.
- One list build leaves 741 `task.db` files open in main, one per chat and per filed task, and nothing closes them.

The poll pauses while the document is hidden, so a window behind other windows does not pay it. The user pasting into it does.

## Measurements

A simulator reproduces the tool's sequence exactly (clipboard write, 60 ms, Cmd+V through the system event tap, 60 ms, restore) and marks each paste so a wrong one is identifiable. A probe in main samples event-loop lateness on a 5 ms timer, and one in the renderer records each paste's clipboard text and the long animation frames. Keystrokes posted to the app's process rather than the system tap never reach Electron, so the dev window has to be frontmost, and the simulator stops if it is not.

Pastes landing the right text, with the poll running and with it paused (the pause patched into the running renderer):

| | poll paused | poll running |
| --- | --- | --- |
| idle | 19 of 20 (the miss was the first key after raising the window) | 24 of 30 |
| agent turn, text only | 40 of 40 | 33 of 40 |
| agent turn, ten shell commands | 30 of 30 | not run |

Every miss coincided with a main stall of 50 to 340 ms. Main's event-loop delay at idle went from p99 78 ms and max about 200 ms with the poll running to p99 14 ms and max 28 ms with it paused, and stalls over 30 ms went from about 25 per ten seconds to none.

The agent's turn is not the problem once the poll is gone. A text turn held main at p99 11 ms, and a turn running shell commands (which run in the bash worker thread, per [the filesystem stall finding](agent-filesystem-work-stalls-the-window.md)) at p99 14 ms. Moving the workspace to a utility process would not have fixed this symptom, and would still leave the poll's cost wherever the workspace lives, including the renderer's half.

The 2.0 chat shows a reply whole, so nothing paints while the model writes; a reply lands at once when the turn ends.

## The prototype, and what it measured

A per-task store generation, bumped by every `setItemRaw` and `removeItem` through the task's storage and by closing it, lets `Store.getMessagesWithParts` keep each whole transcript it reads and hand it back until the task's store changes. It is safe because every write to a task's store goes through main's storage: the bash worker does not open it. With the poll still running every two seconds:

- The route went from 1 to 2 s per call to about 95 ms.
- Idle main event-loop delay: p99 9 ms, no stalls over 60 ms.
- Pastes: 30 of 30 idle, 40 of 40 during a turn.
- The whole workspace test suite passed, after the storage mock counted its writes too.

It is not the shape to ship. Holding every transcript it has read is unbounded, and the stores it could hold run to 50 to 100 MB on disk in the workspaces measured. The shippable form keeps the generation and memoizes the small derived answers on it instead: a task's standing, a chat's row. The window's own poll should also stop carrying standing it does not read.

## The fix

- `chats.tasks` is pushed by `chats.live.tasks` when a filed task may have changed, instead of being polled every two seconds, and every reader shares one subscription.
- A settled task's standing and a filed task's holds are kept until that task's store is written, counted per task by the storage handle in `session-store-storage.ts`. Running and held tasks are read live.
- Both live chat routes collapse a burst of events into one re-read.
- Task databases idle for 30 seconds close once more than 64 are open.
- The chat list mounts only the rows near the view.

On the same 353-chat copy afterwards: `chats.tasks` took 55 to 66 ms, the window idled at main event-loop p99 8 ms with no stall over 30 ms, twenty quick changes to one chat caused two list rebuilds, and open task databases settled at 64. A Handy paste into the composer landed. What the list still pays on boot and on each rebuild is the subject of [the chat list index plan](../plans/completed/chat-list-index.md).

A regression test is `main-stalls.mjs` from the `studio-chrome-devtools` skill, or the simulator above, against a workspace with a hundred filed tasks: pastes should land 60 of 60 with a 60 ms restore, and main's event-loop p99 should stay under 20 ms at idle.

## Related

- [The agent's filesystem work stalls the window](agent-filesystem-work-stalls-the-window.md): the other main-thread stall, which the bash worker took.
- [Move the agent turn off the main thread](../plans/active/agent-turn-off-the-main-thread.md): the process plan this finding re-scopes.
