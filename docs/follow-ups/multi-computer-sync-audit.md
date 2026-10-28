# What a second computer shows of a chat whose task waits on a card

**Status:** open · **Check after:** when using one workspace from more than one computer is taken on · **Last checked:** never

## What we're waiting to learn

Whether every state a chat can be in reads truthfully on a computer other than the one doing the work, once several computers using one workspace is something we design for. This file records one case found while tracing a task's permission card. It is the place for the audit to start, not the whole of it.

A task's permission card is per computer. `ask_permission` in a task records the card with `recordAsk` ([`asks.ts`](../../packages/workspace/src/lib/chat/asks.ts)) in `waitingOn` of the chat's state file for this computer, `.instrument/chats/<id>/state.<device>.json`. `getChatState` reads only the current device's file ([`chat-record.ts`](../../packages/workspace/src/lib/chat-record.ts)). A question the chat asks with `choose` is read from the session log, which every computer syncs ([`open-asks.ts`](../../packages/workspace/src/lib/chat/open-asks.ts)), so a question card shows everywhere and a permission card shows only where it was raised. The task runs on the computer that started it, and whether a task is running comes from that process's own agents (`isWorking`, [`activity.ts`](../../packages/workspace/src/lib/chat/activity.ts)).

On a second computer, opening a chat whose task waits on a folder card:

- **No card.** `openAsks` finds none in that computer's state file, so `PermissionAsksFoot` draws nothing above the composer. The card can only be answered on the computer that raised it. That is also where the grant has to go, since a folder grant lives in that computer's `permissions.json`.
- **The task's line says it waits elsewhere.** Since the commit that added this file, `taskStanding` ([`standing.ts`](../../packages/workspace/src/lib/chat/standing.ts)) finds no card, finds the task not running here, and reads from the synced record that its last turn ended on an `ask_permission` call that put a card up, with nothing after it. It shows "Waiting for your permission on the computer it runs on". Before that, the task read as finished, with its last words as its line. The computer's name is not shown: `device.json` holds it, but nothing reads another device's file yet.
- **The chat row does not say waiting.** `stateOf` in [`chats.ts`](../../packages/workspace/src/lib/chat/chats.ts) counts this computer's permission cards and the chat's open questions, so the second computer's list shows the chat as idle.
- **The transcript may say it.** The note that woke the chat (`data-taskEvent` with the card as a need) syncs but is shown only in developer mode. The chat's reply to it, when it wrote one, syncs and is shown. In the task-session evals the chat often wrote none: it raised a card of its own and ended its turn on it, and that card is also only on the first computer.
- **A phone** reads `chat-list.json` written by each computer. The first computer's rows come from its own state. What a phone shows for this case was not checked.

## The signal

Open a chat on a second computer while one of its tasks waits on a permission card raised on the first. Truthful means each of these says the task is waiting and where it can be answered: the task's line, the chat row, and the composer area. Today only the task's line does.

## Where to look

Two computers signed in to one workspace through a synced folder. Start a task that needs a folder kept closed until asked (a folder under Documents), let it raise the card on the first computer, then open the chat on the second.

## What each answer means

- If multi-computer use is taken on, decide whether permission cards stay per computer (they name that computer's folders and grants) and are only shown elsewhere as waiting there, or move into synced state. Either way the chat row's `stateOf` needs to see a task waiting on another computer, and the composer area may say where to answer.
- Name the computer in the waiting line once something reads other devices' `device.json`.
- Audit every other per-device state with the same question: the tabs a chat's sessions hold, the cards in `waitingOn`, a running task's liveness.

## Result

Open.
