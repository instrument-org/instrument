# Plan: chat transcript redesign

Status: open. Design rules being worked out against real chats; nothing built in Studio yet. How the transcript shows the chat's work: its own steps, its tasks, its tabs and pages, what it asks you, and what goes wrong. The rules below are the proposal as it stands, each drawn in the replay prototypes and marked as matching the app today, changing it, or new. Owner: design (Neil), with engineering (Jeremy) deciding what to build.

## Why

Today a chat's work is a black box. The line under the chat's title is its only loading state ([chat-status-line.tsx](../../apps/studio/src/client/components/window/chat-status-line.tsx)), and it covers the chat's own work and its background tasks alike, so a quick lookup and a three-minute task look the same while they run. Most chats never start a task: the chat answers in a few steps of its own. So the work a person waits on is usually the chat's own, and it should show where the answer is going to appear.

## How the rules are worked out

The rules are drawn against real chats rather than made-up ones, so the long pauses, the runs of twenty calls, the failed requests and the questions show up as they really happen.

- **Replays.** [`.agents/wireframe-kit/replay/`](../../.agents/wireframe-kit/KIT.md) reads a chat's records (its `ses_*.jsonl` logs, tasks included) and plays the chat back in a proposed design, at its real pace, with a scrubber. The rules in this document are the ones that code applies, so a rule changed here changes there, and the reverse. `replay.js` is where each one lives.
- **The chats.** Eval runs on Claude Haiku 5.5 (`pnpm eval`, see the `workspace-evals` skill), chosen for contrast:

| Replay | Eval case | What it tests |
| --- | --- | --- |
| Field research with two tasks | `handoff-long-work` | sixteen questions, two tasks, four failed requests before the first word |
| Pricing pages in tabs | an ad-hoc chat asked to open three pricing pages | the chat's own browsing, the pane, a page in use |
| Three documents as tasks | `chat-three-documents` | three tasks started by one command |
| Three jobs and a folder ask | `handoff-fleet` | a permission card nobody answers, a correction mid-way |
| An essay changed midway | `chat-corrects-the-work-under-way` | two minutes of the chat's own work, then a change of course |
| A question to choose from | `questions-choice-with-note` | a question card, open and answered |

- **The transcript page.** `/debug/components/transcript` ([grouped activities](grouped-activities.md)) scrubs typed, scripted scenarios through the real components. The replays do the other half: real records through a proposed design. A rule that settles here should end up as a scenario there.

## The rules

### 1. The chat's own work shows inline; only a task gets a card

When the chat does the work itself, its steps show in the transcript where its reply is about to go, and fold into one line once the reply is in. Work it hands to a background task gets a card under the reply that started it, with the step the task is on. Nothing moves to the top of the window while the chat works on its own reply.

- **Why.** The answer and the work that produced it belong together, and most chats never start a task.
- **Today.** Changes the app: the status line under the title stands for both kinds of work.

### 2. A summary line uses the activity; the opened list uses each call's explanation

Every call carries an `activity` (a short phase, shared by the calls serving one objective) and an `explanation` (one sentence for that call). A line that sums steps up, such as the working line, the folded line, the chat's row in the list or a task card, shows the activity, so it holds still while the calls in a phase run. The list it opens onto names each call by its explanation.

- **Why.** Three searches run at once can all have the activity "Checking current plan prices", and listing them that way says nothing. Their explanations ("Searching Linear's current pricing", and so on) tell them apart. Shown on the summary line, though, explanations change with every call and read like a log.
- **Today.** Matches [grouped activities](grouped-activities.md), built with its headings behind a flag.
- **Watch.** Explanations are written for the agent as much as for the person: some are plumbing ("Loading the page skill"), some leak names ("the mean nitrate_mg_l across samples.csv"). Before they reach people, the agent's prompt probably needs to ask for them in plain words.

### 3. The working line opens, and says when the chat is thinking

The working line opens onto the steps so far: finished calls with how long each took, running ones with a spinner. When no call is running, the list ends with **Thinking** and how long it has been since the last call ended.

A step's line shows from the moment the chat begins writing its call, not once the call is written: its activity is the first thing in it, and some calls take seconds to write. The call that starts a task carries the task's whole instructions, and in the evals the chat spent 2 to 3.5 seconds writing them before the command ran in a tenth of one; the step's line ("Starting document tasks") is what those seconds are. In the app this means showing a step while its call streams in.

"Thinking" stands for any time the chat is busy with no call running, whether the model is reasoning or still waiting for its first word; a separate waiting state may come later.

- **Why.** Between calls the model is working out its next one, and in the replays that is most of the wait (27 seconds of thinking after a one-second word count, in the essay). Without the last row, the list looks finished while the line above it is still at work.
- **Today.** New.

### 4. The reply streams in

The chat's words appear as they arrive, not all at once when the reply is finished. While they stream there is no working line under them: the words arriving are the chat at work.

- **Why.** Once a model starts writing it is quick (Haiku wrote a two-tagline reply in 0.6 seconds), and most of a wait is before the first word. Streaming ends the wait at the first word rather than the last.
- **Today.** Changes the app: replies arrive whole. The replay works out when each block of words began from the records (when its call was sent, how long its first word took, and when its reasoning ended) and types it out up to when it was written down.

### 5. A call that asks you something is its card alone

A question with choices, a folder or app permission, or signing in to an app is drawn as its card, with no step line in front of it. It never joins a run of steps: the steps before it fold, and the steps after it start a new run. A question card is the app's `QuestionCard`, open and answered, in the transcript where it was asked. A folder or app permission is the app's permission card, just above the reply box ([permission-asks.tsx](../../apps/studio/src/client/components/permission-asks.tsx)), not in the transcript.

- **Why.** The card is the whole of what there is to read; a step line saying "Choosing the tagline tone" above the question repeats it.
- **Today.** Matches the app ([tool-call.tsx](../../apps/studio/src/client/components/message-part/tool-call.tsx), `ToolCallBody`).

### 6. A question card speaks for itself

The chat doesn't announce a question it's about to put on a card: a one-line lead-in like "Asking which tone you want." only repeats the card's own question. A longer message before a question, with something worth saying, stays. While it prepares the card, the working line shows Thinking as usual. Once the card is up, it ends its turn without words of its own, and nothing says it is working until you answer: no working line, no Thinking. The card is the whole of the ask, so "I've put the tone question on a card. Once you pick one, I'll write the tagline." only repeats it. If you asked for more than one thing, the chat can go on with the rest while the card waits, and then its working line shows as usual.

- **Why.** In the eval and in the current beta alike, the chat leads into a question card with a line announcing it and follows it with a sentence about the card.
- **Today.** Needs a harness change. The choose tool ([choose.ts](../../packages/workspace/src/tools/choose.ts)) hands the model "The user now sees your question and its choices on a card in the chat, and answers there", and its description says to end the turn when what comes next depends on the answer, but nothing says to end it without words, so the model closes with a line about the card. Nothing in the prompt asks for the lead-in either ([instrument.ts](../../packages/workspace/src/agents/instrument.ts) already says to skip the preamble); the model says what it is about to do before a step out of habit, which suits work but not a question. The fix is in that result and description: tell the agent the card is the question, so not to announce it before or talk about it after, and to end its turn with nothing more to say. Check it with the `questions-choice-with-note` eval. Until then, the replay leaves out a one-line lead-in written in the same call as the question and the chat's words between a question card and its answer, and counts the chat as waiting rather than working in that time, standing in for the change.

### 7. A task's card sits under the reply that started it

The card shows the task's current activity, drawn as the chat's own working line one size down: a smaller planning dot, breathing with its ring traveling out, and the activity in the brand shimmer. Under it, quietly, the task's name (the one the chat gave it with `instrument task new --name`) and how long it has run. When it finishes, a check takes the dot's place. The step that starts a task shows as the working line until the task exists, then gives way to the card, which takes the line's place rather than appearing under it and jumping up when the line goes (the task exists a moment before the call that started it finishes): once the task exists, its card is the record of starting it, and a folded "Starting the Lisbon packing list" above it only repeats it. When the task finishes it lies flat on a muted gray, with a picture of what it made. Several tasks started by one command each get a card, stacked close together as one set.

Clicking a task's card opens the task's tab in the pane, and the chat list closes, as when opening the chat's tabs. The tab's header is one row: the task's name, and Stop with how long it has run counting up inside it ("Stop · 8s"), which becomes "Done in 25s" once the task finishes, at its own last step rather than when the chat hears. Then the task's transcript, drawn just as the chat's is: first what the chat asked, as a gray message on your side under a small "From the chat" (to the task the chat is the one asking, but it isn't something you wrote), then its words, its folded step lines and its working line. There's nothing to type into, since you talk to the chat.

- **Today.** The card is new. The tab matches the app: a task's tab draws its transcript with the chat's own component (`ChatStream` in [child-tasks.tsx](../../apps/studio/src/client/components/window/child-tasks.tsx)), under its brief and a header with Stop ([task-page.tsx](../../apps/studio/src/client/components/window/task-page.tsx)).

### 8. The chat's tabs show at the top right, and opening them closes the chat list

While the chat works in tabs, the pane button at the top right becomes a chip, "Working in 3 tabs", with small pictures of the newest three pages. The chip is a still muted gray; its label carries the brand shimmer of the working line. The page Instrument is using sits on top of the stack, lifted a little, with the same teal arc running round it as round its favicon in the pane, so the chip says which page is being worked on as it moves from one to the next. Clicking it opens the tabs in the pane and closes the chat list, and the chip goes back to the pane's own icon (a stack of pages, not the sidebar icon mirrored). Once the chat has finished, the chip stays, so the tabs are a click away, and reads "Worked in 3 tabs" in plain gray with no shimmer. It only ever means the chat's own browsing.

- **Today.** New.

### 9. A page in use breathes, and its tab says so

The page Instrument is using has a soft glow inside its edges that breathes gently, and a white badge with a muted border floating just above its bottom edge, "Instrument is using this page" beside a small teal arrow, with a shadow that keeps it readable over the page. Its tab's favicon has a short teal arc running round it, so the tab row says which page is in use even with another tab in front. Nothing is drawn on the page itself, and there is no Take over button. While the chat waits on the person, the glow and badge turn amber.

- **Today.** New.

### 10. The working indicator is the app's

The working line uses the app's planning dot (breathing, with its ring traveling out) and the brand shimmer on the step, as the app draws them today ([planning-dot.tsx](../../apps/studio/src/client/components/icons/planning-dot.tsx), `brand-shiny-text`).

- **Today.** Matches the app.

### 11. A failure shows while the chat recovers

When a request to the model fails and the chat tries again, the working line says so ("Couldn't reach the model, trying again (try 3)"), rather than sitting on "Thinking".

- **Why.** In one eval chat four requests failed in a row, and the first words came 55 seconds after the message.
- **Today.** New.

## Open questions

- **A task that needs you to log in to a website.** The design has the task's card turn amber with Log in and Skip. No such ask exists: the kinds today are a question, a folder, a Mac app and a tab, and the connect-app card is for connecting a service, not for a page a task is reading. To decide with engineering whether this is a new kind of ask.
- **The folded line's words.** The replays head a folded run with its first activity and a count ("Opening pricing pages and 4 more"); grouped activities generates a heading for a run with no activity ("Read 2 files, ran a command and searched the web"). One rule should cover both.
- **A plan checklist** like Claude Code's: what it would take and whether it earns its space (engineering is looking into it).
- **Replies that start with words.** The replays show the chat's short first line ("Checking the Recipes and Receipts folders first.") before its steps; whether that stays, and whether words stream, is still to decide.
