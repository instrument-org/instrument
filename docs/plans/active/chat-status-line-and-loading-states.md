# Plan: the chat's status line and loading states

Status: proposed, not started.

The chat does quick work itself and forks slow work into tasks, and every tool call carries an `activity` heading. The window still draws the chat as if it only talked and delegated: typing dots stand at the transcript's tail for the whole turn, tool work included, and a second "Instrument is working" row appears at the tail while a task filed from the chat runs. The chat shows none of its own tool calls outside developer mode, so for a turn that spends a minute in tools the user sees dots and nothing else, and the header's step line only ever names a filed task's step. This plan makes the dots mean one thing (a reply is being written) and moves everything else to one line under the chat's title.

## States

| State | Typing dots | Line under the chat title | Pressing the line | Inbox row's peek |
| --- | --- | --- | --- | --- |
| Idle, nothing in flight | none | nothing | nothing to press | the last reply's first words, as today |
| Sent, no step back yet | none | "Instrument is working" | the foreground steps list, empty until a step lands | "Instrument is working" |
| A reply's words are streaming (a step with text and no tool call yet) | at the tail | the turn's latest `activity`, or "Instrument is working" when the turn has none yet | the foreground steps list | the same text as the line |
| Foreground tool work (a tool call streaming or running in the chat's own turn) | none | the latest `activity` heading of the chat's own turn (falling back to `explanation`, as `latestStepIn` does) | the foreground steps list: the turn's steps by heading, newest last | the same text as the line |
| Only forks running, the chat's own turn over | none | the running fork's latest `activity` (the newest fork's when several run) | that fork's card: its row with title and step, which opens the fork's page beside the chat | the same text as the line |
| Foreground work and forks at once | as the foreground row says | the foreground heading, since that is what this chat's next reply waits on | the foreground steps list, with the running forks' rows under it | the same text as the line |
| Stopped on a question (the chat's own, or a fork's) | none | the question, in the amber `WorkLine` uses today | the fork's card for a fork's question; nothing for the chat's own, which is the last reply on screen | the question, as today |
| Turn ended in an error or was stopped | none | nothing | nothing to press | as today |

"Foreground steps list" is new: the chat hides its tool calls, so the line is the only way into what the current turn did. A popover of one row per step heading, in the style of `TaskRows` in `chat-activity.tsx`, is enough; developer mode keeps drawing the calls in the transcript.

## What goes

- **Dots for the whole turn.** `chat-stream.tsx` draws `TypingRow` at the tail whenever `presentation === "chat" && (isAgentRunning || isAwaitingFirstRow)`. The condition becomes "the last assistant message has a text part streaming and no tool call after it". `isAwaitingFirstRow` (computed beside `trailingTurnHasContent`) stops driving the dots. `isComposing`, which holds a step's words back until the step is done, stays: the dots stand in for exactly those held-back words.
- **`WorkingRow`.** `window/working-row.tsx` and the `isWorkingElsewhere` / `transcriptTrailing` wiring in `window/chat-screen.tsx` are deleted; the line under the title says what that row said.

## Data

`Chat.runningTasks` (`packages/workspace/src/lib/chat/chats.ts`) carries each filed task's `step` and `waiting` through `chatActivity` and `runningLines` (`lib/chat/activity.ts`), but nothing carries the chat's own step. Add an own-work field to `ChatSchema` (for example `ownStep`), filled from `runningLines(chatId)` while `chatIsAlive(chatId)`, so the header and the inbox row read one value from the live chat list. The foreground steps list reads the chat's transcript, which `chat-screen.tsx` already has; `latestStepIn` gives the label rule for each row.

## Files

- `apps/studio/src/client/components/chat-stream.tsx`: the `TypingRow` condition and `isAwaitingFirstRow`.
- `apps/studio/src/client/components/window/chat-screen.tsx`, `window/working-row.tsx`: remove the tail row.
- `apps/studio/src/client/components/window/chat-header.tsx`: the line under the title; `ChatHeading` keeps the title row.
- `apps/studio/src/client/components/window/chat-activity.tsx`: the step it draws at the head's right moves to the line; the checklist mark that lists the chat's tasks stays; the foreground steps list joins `TaskRows`.
- `apps/studio/src/client/components/window/chat-window.tsx`: the floating chat's head, which also renders `ChatActivity`.
- `apps/studio/src/client/components/window/chat-row.tsx`: `WorkingPeek` reads the own-work field before `runningTasks`.
- `packages/workspace/src/lib/chat/chats.ts`, `lib/chat/activity.ts`: the own-work field.
- Tests beside them: `chat-stream.test.tsx`, `chat-activity.browser.test.tsx`, `chat-row.browser.test.tsx`, `lib/chat/chats.test.ts`.

The task page (`components/task/chat.tsx`) passes `isAgentRunning` too, but draws a task's transcript with its tool calls and no typing dots, so it is out of scope.

## Open

- Whether the gap between send and the first streamed token shows the dots. The table says no, since the line already says the chat is working; if it reads as dead in the app, the dots can cover that gap as well without changing anything else here.
