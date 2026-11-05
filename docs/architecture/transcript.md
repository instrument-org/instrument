# Transcript

How a session's records become what a person reads. A chat and a task's tab draw through the same `Transcript` ([transcript.tsx](../../apps/studio/src/client/components/transcript/transcript.tsx)); a task differs only in its first turns being its chat's, folded behind one line, and its opener being its assignment.

## The layers

1. **Records.** A session's messages and parts, as [chat-records.md](chat-records.md) describes them.
2. **Light messages.** `transcriptMessage` ([transcript-message.ts](../../packages/workspace/src/lib/transcript/transcript-message.ts)) turns each tool call and thought into a `StepPart`: its words, its status, and `shows`, what it can put on a card, cut to a card's length. The command and output stay behind, so a transcript of long scripts costs what its words cost.
3. **The feed.** `message.live.feed` ([feed.ts](../../packages/workspace/src/lib/transcript/feed.ts)) sends the session's last turns once, then only what moved: a text part's new characters as an append, a part's change as a patch. `message.older` asks for the page before, and `message.live.whole` reads one message whole for a step someone opened.
4. **Turns.** `turnsOf` ([turns-of.ts](../../packages/workspace/src/lib/transcript/turns-of.ts)) decides everything drawn, and no component reads a part to choose what to draw. The same messages always give the same turns, so changing a rule rewrites no records.
5. **Rows and cards.** [`components/transcript/`](../../apps/studio/src/client/components/transcript/) draws what `turnsOf` says. It reaches the app only through `TranscriptSurface` ([surface.ts](../../apps/studio/src/client/components/transcript/surface.ts)): pictures, opening files and tasks, stopping a task, a step's whole part. That seam is what lets the transcript debug page drive the same components from a script, with no records under them.

## What a turn is

Everything since the message the person typed. A wake stays inside it: a sign-in answered or a task finished carries the same work on.

A turn's rows are its activities, asks, task cards, notes, errors and words. An activity is a run of calls the agent gave one `activity` label, shown with its explanation while it works and its counts and clock once done.

**The fold.** A turn that ended with words folds what came before them into one Worked row, which reads the turn's summary, or how long it worked until one lands. It folds when the summary arrives or `FOLD_WAIT_MS` after the turn ended, whichever is first. A turn that was stopped, failed or ended without words stays open, since that is there to read. A message that joined mid-turn folds the finished work above it at once. Task cards, notes and errors never fold.

**A message sent during a step.** It is stored on arrival and opens the next turn with nothing under it, and says "Read after this step" (`waitsForStep`) while the step above keeps its working line. At the next point between steps the agent writes it again with `MID_TURN_NOTE`, which is what `joinedMidTurn` reads, and the work above folds.

## The card

One card is up at a time, and all of its rules are in `cardsOf` and `slotOf` ([slot.ts](../../packages/workspace/src/lib/transcript/slot.ts)), so they can be changed in one place:

- A card stays until a different kind of card replaces it. A call with nothing to show changes nothing, and a call that failed has nothing to show.
- Things of one kind share a card, so a burst of files is one card and a browser's commands update one page.
- A task's card takes over from the work before it, and carries its own card while it works.

The kinds are `page` (a browser's page, or a page or file it opened for the person), `web` (search and fetch), `files`, `images` and `generated`. A page card shows the tab the session drove last, its picture retaken after each page event and agent command. A command shows a card only for a program at the start of a shell line, so a word in its arguments or a task's assignment does not put one up.

## What a shell call did

A command's words say little about what it did, so the call records it. `watchCall` ([file-changes.ts](../../packages/workspace/src/lib/transcript/file-changes.ts)) snapshots the chat's work folder and its folder under `Chats/` before the call, and `fileTouches` compares them after and stats every path named in the command and its output. App calls made from a script are tallied as they happen, and the pages a browser command reached are noted. It all lands as one `data-stepFacts` part ([step-facts.ts](../../packages/workspace/src/lib/transcript/step-facts.ts)), rewritten as a running call moves and final when `settled`. The model never reads it. A number on a row (`counts`) is the agent's label for what the record counted, never the agent's own count.

## The summary line

Each time a session finishes a turn whose work folds, one call on the turn's own model at low effort writes the Worked row's line ([work-summary.ts](../../packages/workspace/src/lib/chat/work-summary.ts)), kept as a `data-workSummary` part on the turn's last reply. It reads the person's message, the steps, what the record says the turn did, and how the reply opens. Nothing waits on it: without one the row says how long the work took. A finished task's card reads the same line, while what the agent reads of the task (`line` on its standing) stays its own last words. Activity lists the calls as Work summary.

## Reading back

A chat opens on its last turns, and `OlderTurns` asks for the page before as the reader nears the top. The scroller keeps what is on screen in place as turns arrive above it. Nothing is virtualized: a chat's DOM grows only as far as someone scrolls back.

## Developer mode

Developer mode adds rows rather than a different transcript: a note only developers see is one line (`DeveloperNote`) that opens onto its detail, and a `state` part's card shows what the model heard of it, read through `stateNotes` in the order a request reads them.

## Beside the transcript

A chat's tabs show only in the pane beside it, under a row of them ([pane-tabs.tsx](../../apps/studio/src/client/components/window/pane-tabs.tsx)). The header's button opens and closes the pane ([pane-toggle.tsx](../../apps/studio/src/client/components/window/pane-toggle.tsx)) and says how many tabs a closed one has. Stop sits where Send does while the box is empty and stops the chat and every task; a task's card stops that task alone. What the chat and its tasks left running is a pill in the header ([background-processes.md](background-processes.md)).

## Checking a change

The transcript debug page (`/debug/components/transcript`, scenarios in [`-transcript/scenarios.ts`](../../apps/studio/src/client/routes/debug/-transcript/scenarios.ts)) replays a scripted session frame by frame, with developer mode a switch away. Add a scenario for a new state rather than a test of its pixels: tests pin the rules in `turnsOf` and `slot.ts`, where they run in milliseconds.
