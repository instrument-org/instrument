# Plan: threads, topics, and activity in the orchestrator conversation

Status: built, first version. Threads, topics, the thread screen, the task card inside replies, the filter bar (Unread, Needs you, Topics, Apps, Sites), and Activity are in; channels and the sidebar are gone. Still to come from the sections below: `@topic` mentions in the composer, suggested-topic chips on rows, the topic overview page, the filter column at wide widths, and adopting tasks from before the orchestrator.

## The rule

There is one chat. It runs in time order and every entry in it is a thread. A thread begins with a message the user sent at the top level, and sending there makes a thread implicitly; there is no other way to start one for now (automations, triggers, and a plain new-thread button come later). The agent never writes at the top level. Inside a thread it answers every message as the orchestrator: the same agent, with tasks underneath doing the work so the thread stays a conversation rather than a log.

One orchestrator per thread. Each thread is its own context window: the user carries two, three, four threads at once and each has an orchestrator of its own, delegating to its own tasks, with nothing from another thread in its prompt. Across threads and tasks, many things run at once. An orchestrator can look across the workspace with a command when it needs to (what the other threads said, what their tasks are doing right now), which widens its view on demand without polluting it.

Topics replace channels. A topic is a tag on a thread: many threads to many topics, applied when the thread is made or any time after, removable, suggested by the agent, mentioned in a prompt, and read by the agent as context. For today a topic's job is to filter the top-level list. Topics keep a name, an emoji, and a color, and will grow instructions, memory, apps, and files of their own.

Each row at the top level shows the ask that opened the thread exactly as typed, a generated title that keeps changing as the thread goes on, one line saying where the thread stands (the latest reply, the question it is waiting on, or the step it is working through), and marks for what it has made and used: files, sites, apps. Opening a thread puts the title at its head and the first message at the top of the scroll; a thread can run for days.

Activity is the third thing: one chronological record across every thread of what the user asked, what the agent replied and did, tasks starting and finishing, files made, apps and sites used, and the user's own actions, in the chat's row grammar, each row a door to its thread.

Nothing carries over from channels. Layouts, splits, dragging, and the bell are later rounds; today is the Slack-shaped top level, the drill-in, topics, and Activity.

## Nouns and where they live

| Noun | Where | Notes |
| --- | --- | --- |
| Thread | A top-level session of the orchestrator task (`parentId` absent) | `Store.getSessions(taskId)` is the thread list, oldest first by id. Sub-agent sessions carry `parentId` and are already hidden from it. No new record. |
| Its orchestrator | The session's actor in the workspace machine, spawned per session by `addMessage` | Already one per live session; several per task already run for sub-agents. Model input is that session alone behind its own baseline (`prepare-model-messages.ts`), which is the context boundary. |
| Root | The thread session's first user message | What the row shows as the ask. Carries mentions, attachments, and the view note like any message. |
| Title | `Session.title` | Written by the existing title call on a session's first message (`message.create`); refreshed after each finished turn through `updateSessionTitle` once that lane lands. |
| Topic | `task state.topics[]`: `{ id, name, emoji?, color?, createdAt, retired?, about? }` | The `channels[]` slot with a topic id in place of a session id. `about` is the agent's line about what goes here, for later. |
| Thread's topics | `Session.topics?: string[]` | On the thread's own record, so the list is one read and a filter is a predicate over it. Retiring a topic touches no thread. |
| Seen | `task state.threadSeen: Record<sessionId, messageId>` | Window state, kept off the session record. Unread is every non-user message after it. |
| Task attribution | `task state.taskThreads: Record<taskId, sessionId>`, `appThreads: Record<slug, sessionId>` | `taskChannels` and `appChannels` renamed. The writer already records the session the turn runs in (`TaskCommandContext.sessionId`); the wake already delivers there. |
| Holds | Derived on read | Files from the files fences in the thread's replies, apps from the tasks it started (`--app`) and its own `app call`s, sites from its tasks' browser status parts. Best effort, grows. |
| Working | Derived | The session's actor is alive, or a task recorded to the session is running. |
| Latest | Derived | The step while working (`latestStep` of the running task, or the agent's own explanation label), the question while waiting (`sessionAsk`), the last reply's first line otherwise. |
| Activity entry | Derived on read | One per user message, finished reply, task event, files fence, app call, and `open`, across threads; plus the window's own visits, merged client-side. |

Why not a message-level thread id inside one session: the model input, the session actor, the live message list, the unread count, the ask state, attribution, and the `chat` command are all keyed on a session, and supersession only works per actor. A thread that is a session inherits every one of them, and one actor per session is the one-orchestrator-per-thread rule with no new machinery.

## The window

Left, the chat pane: the filter bar, the thread list, the composer at its foot. Fixed rather than a sidebar: the divider still drags, nothing collapses, there is no rail and no pins. Right, the tab strip and the tabs exactly as they are: screens and pages. A thread opens as a tab on the right, and a card the thread hands over opens as another tab beside it. The window bar's top-left is empty for now (layouts later). Window tabs are one set, no longer kept per channel. The new-tab page stays; its Tasks door goes (a task is reached from its thread's card, and the task page keeps its address); topics arrive on it later.

## The flows

1. Send at the top level. The composer calls `message.create({ id, prompt, viewing })` with no `sessionId`; the route already creates a session in that case, writes the root, titles it, and `addMessage` spawns an actor over the new session. The reply lands in the session. Nothing changes in the route.
2. Reply in a thread. `message.create({ sessionId })` as today. A live actor steers, or is superseded when the user typed; an idle one spawns. A follow-up in one thread touches no other.
3. Tag. `orchestrator.threads.setTopics` writes `Session.topics`, from the row's tag menu or from the agent's `chat tag`. The next user turn in that thread carries a `data-threadTopics` part naming the thread's topics, rendered as a note only when it differs from the last one, so the agent learns the change without the baseline moving.
4. Wake. Unchanged: a task finishing looks up `taskThreads[taskId]` and writes its `data-taskEvent` into that session. The row's latest line follows.
5. Filter. Client-side over the list: unread, needs-you, topics; apps and sites once holds are in.
6. Activity. `orchestrator.activityLog.list` derives entries from every thread's messages, newest first, with the thread's id and title on each; the window merges its own visits and draws the same filter bar over it.

## The agent

- The baseline's Channels section becomes a Threads section: this session is one thread; the user opened it with the first message and every message here is theirs to you; everything you write lands here; the user reads the thread's title and your latest line in a list of threads and opens the thread for the rest; other threads and what their tasks are doing are read with `chat`.
- The root message carries a `data-threadContext` part written at creation: the newest dozen threads as `when · title · topics · latest line`. Deterministic, since it is stored rather than read live, and it is how three words typed fresh ("add the Zevia line") find the thread they belong to.
- Topics reach the agent as the `data-threadTopics` note: each topic's name, emoji, and `about` line.
- `chat` reads threads rather than channels: `chat threads [--topic <name>] [-n 20]` (each with its state: working, waiting, idle, and its running tasks), `chat read <id or title words> [--tail <n>]`, `chat search <words>`, `chat topics`, and `chat tag <thread> <topic>` for when the user asks it to file ("apply topics to the last five days"). Suggesting a topic on a row is a later round.
- "One thread, many tasks" is now literally true per thread. The burst rule applies to follow-ups inside a thread; a burst at the top level is several threads answered separately, by construction.

## Studio

1. The chat pane: the filter bar (Unread in brand and Needs you in amber, each with its count and only while true; Topics as a chip that opens a menu; Apps and Sites the same once holds exist), day heads, thread rows, and the composer at the foot ("What do you need?"). The composer is `PromptInput` on its own with the task-scoped draft, sending with no session. Nothing shows before send.
2. The thread row, in the shape the wireframes settled on: one header line (a dot when there is state, brand for unseen and amber for needs-you; the title in bold; the time; the topic marks as emoji on color; the count, or `N new`, or `Needs you` with a question glyph; when the last reply landed; the files and then the apps and sites as real marks behind a hairline), the ask under it untouched and clamped with a fade, one peer line: the latest reply's first line, the question, or the step in brand with the sites it is on. No avatar, no name, no counts as decoration, no task list. Hover controls: tag (every topic with a check, a new topic at the foot), open. Plain click opens the thread on the right.
3. The thread screen at `/orchestrator/threads/$sessionId`: a non-scrolling head (topic mark, the bold title, since when, a strip of what it made and used oldest left, clipping to `+N`), then `TaskChat presentation="orchestrator"` over the session with the placeholder "Reply in thread" and a draft key of its own (`{ scope: "transient", id: sessionId }`, or it shares the top-level field's draft). The running task comes back as a contained card inside the reply (`created-task-card.tsx`: the service's mark, the name in brand, the last steps as a small timeline, no avatar or time) that opens the task page as a tab and collapses to one quiet line when done. `screenPresentation` gains a `thread` kind; `useOnScreen` reports the thread.
4. Topics: the tag menu on the row, the Topics chip and its menu (a find field once there are many), the new-topic dialog (the new-channel dialog renamed, with its mark picker). Mentions with `@`, the topic overview page, and suggestion chips are the next round.
5. Activity at `/orchestrator/activity`: rows in the chat's grammar, newest first, day heads, the same filter bar, each row opening its thread. Reached from the new-tab page.
6. Deleted: the channel rail, strip, banner, menu, and details dialog, `selectedChannelAtom`, the sidebar's collapse and pins, the `orchestrator.channels.*` routes, `lib/orchestrator/channels.ts`, the Channels prompt section, the running-tasks banner, and the channel annotation on the Tasks page (the thread's title takes its place).

## Legacy

- Sessions that were channels in a development workspace become threads named after the channel, with everything said in them. Delete the workspace or leave them.
- Tasks from before the orchestrator are a hard fork. They are one adoption away when wanted: set `parentTaskId` to the orchestrator so the task's folder mounts, make a thread whose root is the task's first prompt and whose reply is a wake-shaped summary linking the transcript and the folder. Optional, per task, later.

## Build lanes

1. Workspace, threads: `lib/orchestrator/threads.ts` (list with root, title, topics, count, latest, working, ask, holds, unread), `orchestrator.threads.list` and `.live.list` (re-list on task-wide `changedMessageBatches` and `session.updated`), `orchestrator.threads.seen`, the attribution rename. Tests beside `channels.test.ts`.
2. Workspace, topics: `lib/orchestrator/topics.ts` over task state, `Session.topics`, `orchestrator.topics.{list,create,update,retire}`, `orchestrator.threads.setTopics`, the `data-threadTopics` part and its model note, `chat` over threads and topics including `tag`.
3. Workspace, agent: the Threads prompt section, the `data-threadContext` part, re-titling after a finished turn, deleting channels.
4. Studio, the pane: the filter bar, thread list, row, and composer on the left; the rail, sidebar collapse, pins, and banner removed; window tabs as one set.
5. Studio, the thread screen: head, transcript, composer, the task card restored, presentation and on-screen note.
6. Studio, topics: tag menu, Topics chip, dialog reuse.
7. Workspace and Studio, Activity: `orchestrator.activityLog.list` and the screen.

Order: 1, then 4 and 5 in parallel; 2, then 6; 3 beside 2; 7 after 1. Workspace lanes need a restart of the instance; Studio lanes hot-reload. Judge the agent side in a fresh session with `pnpm eval run --orchestrator` on the free model: two asks sent back to back answered in two threads by two orchestrators at once, a follow-up in one thread, a fresh three-word top-level message that finds the earlier thread through the overview.

## Accepted for this version

- A note the wake cannot attribute lands in the newest thread.
- Each thread's first turn builds a baseline; the bytes before the thread-specific tail are identical across threads, so a prefix cache still hits.
- One title call per top-level message; it is what names the thread.
- The live thread list re-reads every thread on every change. Patch by session if a workspace grows past a few hundred threads.
- The task-level model choice is shared by every thread's orchestrator.

## Open

- Whether `@topic` in the composer ships in this version or the next; the row's tag menu and `chat tag` cover filing without it.
- Whether the agent may suggest a topic on a row (a ghost chip), and how that is stored.
- Whether the divider between the chat pane and the tabs still drags, or the pane takes a fixed width.
- Whether Activity's user-side rows come from the window's visits only, or also from the view notes on sent messages.
