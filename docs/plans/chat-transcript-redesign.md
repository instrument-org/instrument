# Plan: chat transcript redesign

Status: done. Built as [the transcript's map](../architecture/transcript.md) describes, which holds wherever it and this file differ: one card up at a time where this says a card per page, tabs only in the pane, no quoting a bubble. Rule 6's badge and Take over, rule 16's retry line and rule 11's screenshots were not built. The [wireframes](https://instrument.page/chat-transcript-redesign-stop-a-card-per-turn-g6hgcknla553/) show how the rules were worked out. How the transcript shows the chat's work: its own steps, its pages, its tasks, the commands it leaves running, what it asks you, and what goes wrong. The rules below are the proposal as of November 2, 2026, each marked as matching the app today, changing it, or new, with the code it touches. Owner: design (Neil), with engineering (Jeremy) deciding what to build.

## Why

Today a chat's work is a black box. The chat's own transcript draws no steps at all: it is a text chat of bubbles, and its own comment says no step, call or thought is drawn there, in developer mode or out of it (`chat-bubbles.tsx`). The work shows in two other places: a popover that hangs from the line under the chat's title (`chat-activity.tsx`), and a task's own tab ([child-tasks.tsx](../../apps/studio/src/client/components/window/child-tasks.tsx)). The line under the title (`chat-status-line.tsx`) covers the chat's own work and its background tasks alike, so a quick lookup and a three-minute task look the same while they run.

Most chats never start a task: the chat answers in a few steps of its own. So the work a person waits on is usually the chat's own, and it should show where the answer is going to appear. Watching the work is also half of what Instrument is for: you hand it a job, watch it work, and can step in.

## How the rules are worked out

The rules are drawn against real chats rather than made-up ones, so the long pauses, the runs of twenty calls, the failed requests and the questions show up as they really happen.

- **Wireframes from the team's own chats.** Since late October the rules are drawn as wireframe sets made from real Instrument chats, with their messages, activities, timings and replies trimmed to fit: a search for illustrated websites (the chat's own browsing), a comparison of Shopify storefront frameworks (a task and its tab), a Notion database built from a page (an app sign-in and app calls), a rebuild of wireframes in Paper (two long tasks), a rebrand checklist (a message sent mid-step), a background-job test, and a two-minute timer (a command left running). Jeremy reviewed them on October 28 and October 31. The latest set is published as an [Instrument page](https://instrument.page/chat-transcript-redesign-stop-a-card-per-turn-g6hgcknla553/); each rule below also says in its own words what the wireframes settled, so the rules stand without it.
- **Replays.** [`.agents/wireframe-kit/replay/`](../../.agents/wireframe-kit/KIT.md) reads a chat's records (its `ses_*.jsonl` logs, tasks included) and plays the chat back in a proposed design, at its real pace, with a scrubber. It was written against an earlier version of these rules: where a rule below says the replay differs, `replay.js` still draws the older version.
- **Eval chats.** Eval runs on Claude Haiku 5.5 (`pnpm eval`, see the `workspace-evals` skill), chosen for contrast:

| Replay | Eval case | What it tests |
| --- | --- | --- |
| Field research with two tasks | `handoff-long-work` | sixteen questions, two tasks, four failed requests before the first word |
| Pricing pages in tabs | an ad-hoc chat asked to open three pricing pages | the chat's own browsing, the pane, a page in use |
| Three documents as tasks | `chat-three-documents` | three tasks started by one command |
| Three jobs and a folder ask | `handoff-fleet` | a permission card nobody answers, a correction mid-way |
| An essay changed midway | `chat-corrects-the-work-under-way` | two minutes of the chat's own work, then a change of course |
| A question to choose from | `questions-choice-with-note` | a question card, open and answered |

- **The transcript page.** `/debug/components/transcript` ([grouped activities](grouped-activities.md)) scrubs typed, scripted scenarios through the real components. A rule that settles here should end up as a scenario there.

## Words

- **Turn**: your message and everything the chat does until its reply is in.
- **Step**: one tool call. A **command** is a step that runs in the shell; a **call** to an app is a command that goes through `instrument app call`.
- **Activity**: the short phase a step belongs to, shared by the steps serving one objective (`activity` on every call, [base.ts](../../packages/workspace/src/tools/base.ts)). In code a run of steps under one activity is a **declared group**; a run with none is an **inferred group** with a generated heading.
- **Explanation**: one step's own label (`explanation`).
- **Task**: a session the chat started in the background. **Assignment**: what the chat sent a task to start it (the record's `kind: "assignment"`).
- **Command left running**: a shell command still going after its turn ended (`BackgroundProcess` in code; the app already calls it a command).

## The pieces

Read top-down, the transcript is built from five pieces, and every rule below fills in one of them for one state (working, finished, waiting on you, paused, failed). The real chats are how the states were found; the pieces are what gets built.

1. **The row.** One line: a tile at the left, words, the places it touched (favicons, an app's mark) and a chevron. A step, an activity, a folded turn and an opened call are all rows; they differ only in the tile and the words. The tile is the tool's icon on a small gray tile, a raised hand for a step that needed you, and the working mark while the step runs (rules 2, 3, 15).
2. **The ladder.** Rows open onto the level below: a finished turn onto its activities, an activity onto its calls, a call onto its payload. A level that would only repeat the one above is skipped, so the work behind an answer is usually two clicks away and never more than three (rule 3).
3. **Payloads.** What a row opens onto: the command card (rule 3), a page's picture (rule 5), screenshots looked at (rule 11), a script and what it did (rule 8).
4. **Cards.** One family for what sits in the transcript as a thing of its own: a task, a command left running, a sign-in, a question. One shell, two lines, a mark at the left, an action at the right, flat on gray once finished or paused (rule 13).
5. **Live state and chrome.** The working line (rule 2), Stop in the reply box (rule 4), the page in use (rule 6), the commands chip at the top right (rule 12) and the footer on hover (rule 14).

## The rules

### 1. The chat's own work shows in the transcript, where its reply is going

While the chat works on its own, its steps show in the transcript under your message, where the reply is about to appear. Work it hands to a task gets a card instead (rule 9). Nothing moves to the top of the window while the chat works on its own reply.

- **Why.** The answer and the work that produced it belong together, and most chats never start a task.
- **Today.** Changes the app. The chat's bubbles draw no steps (`chat-bubbles.tsx`), and while the chat works they show a three-dot typing bubble (`chat-stream.tsx`). The step drawing exists, in `ChatStream` with its groups (`transcript-layout.ts`), but only inside a task's tab and the popover under the title.

### 2. The working line: activity, explanation, clock

The line for the step in flight shows the activity in the brand shimmer, after the working mark (rule 15), with how long the activity has run. Under it, in small muted type, is the current call's explanation, which rewrites in place, with a soft wash, as each call starts. The favicons of the sites the activity has read join the line one at a time, the line making room for each as it arrives rather than holding space for ones still to come. A line that sums steps up (the folded line, the chat's row in the list, a task card) shows the activity; the list it opens onto names each step by its explanation.

Once a step is done, its mark gives way to the tool's tile (rule 3) and the line goes quiet gray. A step's line shows from the moment the chat begins writing its call, not once the call is written: some calls take seconds to write, and the call that starts a task carries its whole assignment. When no call is running, the working line says the chat is thinking and for how long.

- **Why.** Three searches run at once can share the activity "Checking current plan prices", and listing them that way says nothing; their explanations tell them apart. On the summary line, explanations change with every call and read like a log, so they sit on the second line, where a change reads as progress.
- **Today.** Partly matches. Both fields exist and are required in the schema sent to the model ([base.ts](../../packages/workspace/src/tools/base.ts), `forceLabelsRequired`), and a working group shows its heading with the shimmer and a copy of the step in flight (`group-heading.tsx`). The explanation as a rewriting second line, the clock and the joining favicons are new. An unnamed working group reads "Working", then "Working for" a duration.
- **Watch.** Explanations are written for the agent as much as for the person: some are plumbing ("Listing the Notion tools"), some leak names. Before they reach people, the prompt probably needs to ask for them in plain words.

### 3. A finished turn folds into one line

Once the reply is in, everything before it in that turn folds into one line above it: the step lines, the cards you answered (a sign-in, a question), and the chat's sentences in between ("Notion is connected. Reading the page now."). The turn then reads as your message, one line of work, and the answer. The reply is the chat's words after its last step.

The folded line says what the chat did, in a few words written once the reply is in: "Signed in to Notion, read the page and two posts on X, and made the database". A small model writes it from the turn's activities alone, which are already a list of what happened: not your message or the reply, which would cost more and give it room to describe something that didn't happen. It writes in the past tense, plainly, in about twelve words at most, naming the apps and sites and leaving out the setup steps. It's the same kind of call that writes a chat's title ([generate-title-from-user-message.ts](../../packages/workspace/src/lib/generate-title-from-user-message.ts)). Until it arrives, and if it fails, the line counts the steps instead ("Read 16 pages on 5 sites", "Ran 9 commands"), which Instrument can do itself. Either way, the favicons of the places the chat worked in sit after the words. A line that only says how long the chat worked ("Worked for 1m 22s") says the least, so it's not used.

Opened, the line lists the turn's activities in order, one a line, with the sign-in among them and the in-between sentences where they were. Each finished line leads with its tool's icon on a small gray tile, as the popover draws a call today (`TOOL_ICONS` in [tool-display.ts](../../apps/studio/src/client/lib/tool-display.ts), a 20px tile at 8px corners in `tool-call-summary.tsx`): a terminal for a command, a globe for a page, a magnifying glass for a search, code for a file written, an eye for something looked at. The tile stands 2px wider than the working mark on each side, so the words keep one keyline. A step that asked you something (a sign-in, a question) leads with a raised hand (Phosphor's `hand`) on the same gray tile, with the app's mark after its words: the place you came in, whatever the ask was.

An activity opens onto its calls, with two cuts:

- **Calls where the agent only learned its tools are left out**: listing an app's tools, reading a tool's inputs, testing a connection. They stay in the record. The capability layer already tells them apart from a real call (`apps.tools` against `apps.call`).
- **An activity with one call left opens straight onto that call's command**, since the call's own line would only repeat the activity. One with several lists them by their explanations, each with the app's mark, the tool's name and how long it took, and each opens onto its command.

The command is the card the app already draws for a shell call: a white card at 16px corners with a hairline border, a gray header strip naming the app's tool (or "Command") and how long it took, with wrap and copy at the right, the command after a `$` in the app's syntax colors, and the output in green under a hairline. So the command that did the work is two clicks from the folded line, three when an activity made several real calls.

In the Notion chat, opening "Creating the launch videos database" goes straight to `notion-create-database · 0.7s` and Notion's reply; the call before it, which only read that tool's inputs, isn't listed.

A message you send mid-turn splits the turn: the work before it folds above your message once the reply is in.

- **Why.** In real chats the sentences between steps are narration ("Checking the database tool's inputs before creating it.") and make a finished turn long to scroll past. What happened is worth keeping one click away; the narration is not worth reading twice.
- **Today.** Changes the app. Nothing collapses a turn, and nothing writes a summary. Each group folds on its own, prose closes a group, and a paragraph never folds away later (`transcript-layout.ts`), so a settled turn reads as group, sentence, group, sentence, then the answer. The counted fallback exists for unnamed runs (`summarizeToolRun`, "Read 3 files and ran a command", in [tool-display.ts](../../apps/studio/src/client/lib/tool-display.ts)) and can grow the counts the folded line needs. The opened step keeps today's bash card ([tool-bash.tsx](../../apps/studio/src/client/components/message-part/tool-bash.tsx) on `ToolCard`, the one the task popover shows), with the app's tool named in its header in place of "Ran a command".
- **Watch.** The written summary is one more small model call per turn, after the reply, so it adds cost but no wait. Whether activities alone give good enough sentences needs an eval across real turns. Some in-between sentences carry findings, not narration (in the Shopify task: "the Next.js Commerce repo was archived on October 20"). If those matter after the fact, the opened list may need them, muted, between activities. A task's tab keeps its sentences while it runs, since there they are the task's report.

### 4. Stop is in the reply box, and typing turns it back into send

While the chat works on its turn, the reply box's send button becomes Stop, in the same teal. As soon as you type, it turns back into send, so you can steer the chat mid-turn without stopping it; clearing the box brings Stop back. A message you send while a step is running shows "Read after this step" under its bubble, until the chat takes it.

- **Why.** Stop belongs where your hands are, the way Claude does it. In the rebrand checklist chat, a link sent mid-step showed no sign of arriving, and it was sent again 17 seconds later.
- **Today.** Changes the app. The composer has no Stop on purpose: "the chat's is on the line under its title" ([task/chat.tsx](../../apps/studio/src/client/components/task/chat.tsx)), where hovering the line swaps its dot for Stop, which stops the chat and every task. A message sent mid-turn already joins the running turn at the next step boundary (`MaybeSteering` in [agent.ts](../../packages/workspace/src/machines/agent.ts)), but nothing shows it: `joinedMidTurn` is exported and never called in Studio.

### 5. One page card per turn, under the step that uses it

When the chat opens a page in its browser, a small card sits right under that step, lined up with its words: a live picture of the page, and its favicon and title under it, so step and page read as one unit. The picture follows the agent: the page loads, scrolls while it pulls things out, and moves on. Every page the chat uses until you next send a message collects in this one card, the newest in front and the rest as favicons in its row, each of which opens its page. A quick read without the browser only adds a favicon to the step line, so the card never flashes up for a glance. A button at the card's top right, an arrow pointing up and right, moves the page to the pane. After you send a message, the next page gets a new card. Once the reply is in, the card goes with the rest of the turn's work (rule 3), and the tabs the chat opened close unless you clicked into one.

- **Why.** Jeremy, reviewing it: much better than tabs elsewhere, because it keeps what's important in line.
- **Today.** New. A browser step is a bash row whose command names URLs, drawn with a favicon, the top domain and "& N more" (`BrowserChip` in [tool-bash.tsx](../../apps/studio/src/client/components/message-part/tool-bash.tsx)). The replay still draws the older "Working in 3 tabs" chip at the top right, which this replaces.

### 6. A page in use says so, and you can take it over

Moved to the pane, the page Instrument is using has a soft glow inside its edges and a badge floating above its bottom edge, "Instrument is using this page", with Take over inside it after a thin divider: watching a page is when you're most likely to spot a mistake. Its tab's favicon has a short teal arc running round it. While the page is in the pane, the card leaves the transcript and the step keeps its favicons. Taking over pauses the chat: its line reads "Paused while you use Siteinspire", with a pause on its tile and Continue, the app's dark button, to hand the page back.

- **Today.** New. A tab the agent drove in the last 30 seconds gets the shimmer on its title ([use-target-agent-activity.ts](../../apps/studio/src/client/hooks/use-target-agent-activity.ts), [tab-strip.tsx](../../apps/studio/src/client/components/window/tab-strip.tsx)), and nothing else: no badge, glow, arc, Take over or Continue.

### 7. A step that asks you something is its card alone

A question with choices or a sign-in to an app is drawn as its card, with no step line in front of it, under the step that led to it. While it waits, there's no working line, since nothing happens until you answer. The chat doesn't announce a card it's about to put up, or talk about it after: the card is the whole of the ask. A folder or Mac app permission is the permission card above the reply box.

- **Today.** Matches for the cards: `connect_app` ends the turn and its card opens itself ([tool-connect-app.tsx](../../apps/studio/src/client/components/message-part/tool-connect-app.tsx), "Sign in to Notion", "Signs in at notion.com.", "Sign in here", "Sign in with your browser", "Not now"), and so does the question card. The lead-in and follow-up lines need a change to the choose tool's result and description ([choose.ts](../../packages/workspace/src/tools/choose.ts)); check it with the `questions-choice-with-note` eval.

### 8. An app's steps show the app, and open onto the command

A call to an app is a shell command through Instrument's app command (`instrument app call notion notion-fetch '{…}'`), so Instrument knows the app and the tool from the command itself. Its row leads with the command tile, then its explanation, the app's mark, the tool's name in small mono type and how long it took, and it opens onto the command card, whose header names the app's tool (rule 3).

When the chat writes a script that makes many calls from one command (`import instrument` in Python, `instrument` in Node), the script is still one step. While it runs, its line shows the app's mark and a running count of what it has done there, as plain text ("9 rows added"), with no total, since nothing knows the total until the script ends. The count works for any app ("3 drafts created", "40 files renamed"). It's one call, so its activity opens straight onto the script in the command card ("Python script · 41s" in its header), with what it printed, and along the card's foot what it did in the app, its repeated calls grouped and counted ("Added a row for each video · notion-create-pages · 14 calls").

- **Why.** A step that says only "Ran a command" hides the most important thing about it: which of your apps it touched.
- **Today.** New. The calls run through `APP_COMMAND` ([app-command.ts](../../packages/workspace/src/lib/shell-commands/app-command.ts)) into the app capabilities, which know a call came from the shell or a script (`surface: "cli" | "script"` in [define.ts](../../packages/workspace/src/lib/capabilities/define.ts)), but the record is an ordinary bash part with no app or tool on it, and nothing counts a script's calls. The count needs the capability layer to report each call as it happens.
- **Watch.** How often the agent reaches for a script against an app needs dogfooding (Jeremy). In the Notion chat it made every call its own command.

### 9. A task's card sits under the reply that started it

A task the chat starts gets a card under the reply that started it: the task's current activity in the shimmer, with four small dots pulsing after it, over "Task", its name and how long it has run, and at the right the favicons of the sites it has read. Hovering brings up the task's own Stop. While its tab is open beside the chat, the card is flat on a pale teal with a teal edge, selected rather than raised. While the chat sorts out something the task needs, and once the task is done, the card lies flat on a muted gray, with a pause or a check after the title. Once it's done, its first line stops showing the last activity ("Checking the banners", the last few minutes of a six-minute run) and becomes a sentence about the whole run, written the way a finished turn's line is (rule 3): "Built 5 artboards in Paper and checked each against the wireframes". A task can't ask you anything: what it needs goes to the chat, which asks you (a sign-in card in the chat, with the task's card paused), or answers it itself. When a task runs past the time the chat expected, the chat checks in and says where it has got to.

- **Today.** The card is new: `CreatedTaskCard` is a one-line row inside the bash step that started the task (`created-task-card.tsx`), so a chat only shows it in developer mode. Tasks routing their needs through the chat matches: "no question or app sign-in reaches the user" from a task, which ends on a `needs` fence the chat acts on ([instrument.ts](../../packages/workspace/src/agents/instrument.ts)); folder and Mac app permissions are the exception.

### 10. A task's tab shows its assignment and its own transcript

Clicking a task's card opens its tab beside the chat. The header is a plain toolbar under the tab row: the task's name on the left and Stop with how long it has run inside it ("Stop · 1 min 12s") on the right, which becomes "Done in" once it finishes, on the tab row's own insets with one hairline under it, so it reads as part of the pane's chrome. A page's tab gets its address row in the same place. Under it, the transcript starts with a folded divider, "Earlier in the chat · 1 message", standing for the chat's history up to the hand-off, which the task carries on from. Then the assignment, shaped like your own messages and on their side but gray, under "Assignment from the chat", with its steps clamped behind Show all. Then the task's words, step lines and working line, drawn as the chat's are. There's nothing to type into. The pages a task reads are ordinary tabs in the same row.

- **Why.** The assignment is the chat's words, not yours, and usually more than you said: in the Shopify chat it was your request word for word plus five steps the chat wrote. Showing only the first line made it look like your message copied over.
- **Today.** Mostly matches. The header with Stop ([task-page.tsx](../../apps/studio/src/client/components/window/task-page.tsx)) and the transcript with no composer ([child-tasks.tsx](../../apps/studio/src/client/components/window/child-tasks.tsx)) exist; the assignment is the first message, with no label, and "From the chat" exists only in a developer-mode card. The divider, the label and Stop with its time inside are new. The tab also shows a row of chips (model, effort, folders, tabs) that the wireframes leave out, to decide.

### 11. Checking its work, the chat shows what it looked at

When the chat or a task checks its work by looking at screenshots (Paper's render of an artboard, a page it made), its step leads with an eye on its tile and shows them: small in the row, the way a page's favicon sits in a browsing step, and larger when opened, with the one that failed marked and why. Browsing doesn't need this, since its card already is the picture.

- **Today.** Partly. An image read with `read_file` shows in its opened card ([tool-read-file.tsx](../../apps/studio/src/client/components/message-part/tool-read-file.tsx)), where steps are drawn. A screenshot from `agent-browser` goes to the model only ([bash.ts](../../packages/workspace/src/tools/bash.ts)).

### 12. A command left running gets a card, and a chip at the top right

A command still running after its turn ends gets a card under the reply, built like a task's: its name in the agent's words, "Command" with its time and when on the line under it, and Stop at the right as the app's own button. Its mark is a clock with a wedge taken out (Phosphor's `clock-countdown`) in a neutral gray well, the setup screens' well shape. Clicking the card opens the command itself, in the command card of rule 3. When it ends, the card lies flat and gray with how long it ran.

Every command gets this one card and this one mark, with no bespoke card per kind of command. A command differs only in the words on its second line. When Instrument knows when it ends (a timer, a wait), they say when it ends and how long is left ("Ends at 8:11 PM · 1:18 left"); otherwise when it started and how long it has run ("Started at 8:10 PM · 0:40", a plain count up). The counting time goes last, so as it ticks nothing before it moves. Knowing the end needs the call to say it, a duration or end time on the `bash` call the agent fills in when it knows one.

While any command runs, a chip at the top right, by the pane button, says what's running in the app's own words ("2 commands running", as `RunningBadge` says it), styled like the header's other buttons (a rounded square at 10px corners, a hairline ring, barely lighter than the bar) with the same clock at the pane button's size: it holds still there however long the chat's title is. It opens a plain list, one row a command drawn as its card is, a hairline between rows and a long name cut short. The list shows what's running, not the commands themselves: clicking a row opens its command right under it, and the rows below move down.

- **Today.** Changes the app. The word matches: the code says "command" throughout. Today a running command shows as a `RunningBadge` pill, "1 command running", on its step row, on its group's heading and in a task's header ([running-badge.tsx](../../apps/studio/src/client/components/task/running-badge.tsx)), and as "· 1 command running" on the line under the title once nothing else is working. Their lists say "Still running", "Commands" and "Stop this command" ([task-background-processes.tsx](../../apps/studio/src/client/components/task/task-background-processes.tsx), `chat-activity.tsx`).

### 13. The cards in a transcript are one family

Every card that sits in the transcript (a task, a command left running, a file, a sign-in, a question, a page's card, the commands list) shares one build: a white card at 20px corners with 14px of room inside on every side, the name on the first line, what kind of thing it is and a detail on the second ("Task · Comparing Shopify frameworks · 1 min", "Command · Ends at 8:11 PM · 1:18 left"), anything that counts going last, and its action as the app's own button, at `rounded-lg`, never a pill. A card about a thing outside the chat (a site to sign in to, a command, a file) carries its mark in a 36px plate or well in its top-left corner: an app's mark on white (the sign-in card's `AppIcon`), a command's clock on gray, a file's type icon on a tint of its color. The plate or well in a card's corner takes 20px less its 14px inset, 6px, so the curves run parallel; buttons and Stop keep the app's 8px, and a page card's open button sits 12px in at 10px. The command card a step opens onto keeps the app's 16px, since it sits in a list rather than the transcript.

A card that asks you something (rule 7) keeps that build: the plate, then a column with the ask in 14px, the reason in 13px at a 19px line, and where it signs in in small type beside a lock, with its buttons under the column on the same left edge, so the words and the buttons share one line down the card. Today's `ConnectCard` packs the same parts tighter (the reason at 12px on a 20px line, the buttons across the card's full width under the plate).

A card that is finished or paused lies flat on a muted gray.

- **Today.** New as a family. The app's Button has no fully round style ([button.tsx](../../apps/studio/src/client/components/ui/button.tsx)); the round ones are badges and chips. Tool cards today are `ToolCard`, white at `rounded-2xl` with a border ([tool-card.tsx](../../apps/studio/src/client/components/message-part/tool-card.tsx)).

### 14. The turn's footer shows on hover

A finished turn ends in a footer: Copy, how long the turn took, the model that answered, and when, in one row from the left. It shows only while you hover the turn and keeps its row the rest of the time, so nothing shifts. There are no Sources, since the sites a turn read already show on its work. A turn that started a task gets its footer only once the task is done, and a command left running sits above it.

- **Today.** Mostly matches `AssistantMessagesFooter` ([assistant-messages-footer.tsx](../../apps/studio/src/client/components/assistant-messages-footer.tsx)), which is hover-only, but it has Sources (and stays visible when there are any), and it only draws in `ChatStream`, so the chat's bubbles have none.

### 15. The working mark

The working line's mark is a nine-dot grid that breathes and bursts into a single shape and back, slowly and smoothly, small enough to sit at the size of a checkmark. It stands for the chat at work everywhere the chat's own work shows. A task's card uses its four pulsing dots instead, so a task reads differently from the chat's own working line.

- **Today.** Changes the app's mark: the planning dot (a brand sphere with a traveling ring) is used on the status line, group headings, step rows and the task popover. The brand shimmer it sits beside matches (`brand-shiny-text`).

### 16. A failure shows while the chat recovers

When a request to the model fails and the chat tries again, the working line says so ("Couldn't reach the model, trying again (try 3)") rather than sitting on Thinking. A reply that broke off partway and was asked again folds into one quiet row, a circling arrow on its tile ("The reply broke off, so Instrument asked again"), that opens onto what was lost.

- **Why.** In one eval chat four requests failed in a row, and the first words came 55 seconds after the message.
- **Today.** Changes the app. Outside developer mode, a failed message the turn went past is hidden, error and partial words alike ([retried-away.ts](../../apps/studio/src/client/lib/retried-away.ts)); while the backoff waits, the failed message's error likely shows until the retry lands. A turn that ends on a broken reply shows "Reply was cut off" ([describe-message-error.ts](../../packages/workspace/src/lib/describe-message-error.ts)).

## Open questions

- **A card's kind label above or below its name.** The task card puts "Task" on the line under the name, and the command card follows it; putting the kind above the name, for every card at once, is the alternative.
- **A plate for tasks.** Commands and sign-ins carry a mark at the left and tasks don't; whether a task gets one, and what goes in it.
- **The task tab's chips** (model, effort, folders, tabs): whether they stay above the assignment.
- **Counting what a script did** needs the capability layer to report calls from `surface: "script"` as they happen (rule 8).
- **A plan checklist** like Claude Code's: what it would take and whether it earns its space (engineering is looking into it).
- **The replay** draws the older rules for the tabs chip and the task tab; bring `replay.js` up to these or retire it in favor of the wireframes.
