# Plan: the Instrument 2.0 orchestrator spike

Status: first version built and running behind developer mode. The feel test is next. Design context is the "Instrument 2.0 - Prototype Handoff" note and the tenets it points to; this file records what the code does and what is still open.

## What it is

One agent the user talks to, which never does the work. It creates tasks, each run by the working agent with its own tools, folder, browser, and model, and it keeps one conversation answering while they run. The user sees replies and links; tasks are the machinery behind them.

The spike changes nothing the current app does. It adds a task kind, an agent, a tool, a shell command, a wake, and a second window, and it reuses the session machine, the sandbox, the browser pool, and the chat stream as they stand.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Task kind and parent | `schemas/task-kind.ts`, `schemas/task-settings.ts` | `kind: "orchestrator"` marks the task the user talks to; `parentTaskId` marks a task it created. Both absent on every task a person made. |
| The `instrument` agent | `agents/instrument.ts` | Four tools: bash, `read_file`, `choose`, `reply`. No writing, web, browser, or native binaries. Its prompt carries the dispatcher rules: reply first, delegate everything, never wait on a task, one thread over many tasks. |
| `reply` | `tools/reply.ts` | The orchestrator's only voice. The schema caps the length. Rendered as prose, not as a tool row. |
| The `task` command | `lib/shell-commands/task.ts` | `new`, `send`, `stop`, `list`, `show`, `log`, `model`, `wait`, `archive`, scoped to the calling orchestrator's children. `new` and `send` take the brief on stdin through a quoted heredoc, because a `$800` inside double quotes reaches the command as `00`. |
| The orchestrator's sandbox | `lib/create-bash-env.ts` (`orchestrator` option) | Builtins, `rg`, `task`, and the job commands. Children mount read-only at `/tasks/<id>`; attached folders at `/mnt` as usual. |
| The wake | `lib/orchestrator/wake.ts` | One subscriber on `session.done`. A child of an orchestrator finishing a turn becomes a `data-taskEvent` part on a text-less user message in the orchestrator's session, debounced so several finishing together arrive as one note naming all of them. |
| Queue drain | `machines/session.ts` | A turn that ends goes to `ProcessingQueuedMessages` rather than `Done`, so a message that arrived mid-turn runs next instead of being dropped. This is what lets the orchestrator's composer stay open while it works, and what makes `task send` into a busy child land at all. |
| Steering between steps | `machines/agent.ts` (`MaybeSteering`), `machines/session.ts` | A message that arrives while a turn runs is handed to the agent, which writes it into the transcript at its next point between steps and continues, so the next request sees it. The session keeps it queued until the agent says it consumed it, so a turn that ends first still runs it as a turn of its own. |
| Which agent answers | `lib/agent-name-for-task.ts` | Read from the task record where a message is sent, so any surface that sends to an orchestrator runs the orchestrator's agent. |
| The window | `apps/studio/src/electron-main/windows/orchestrator.ts`, `client/routes/orchestrator/index.tsx` | A second window on the renderer bundle, the way onboarding is. The task page's chat with the sidebar and pane left behind, always submittable, with the children listed beneath. Opened from the Developer menu ("Open Instrument 2.0 Window", Cmd+Shift+I) or the `orchestrator.openWindow` route. |
| Evals | `evals/cli.ts` `--orchestrator` | Runs an ad-hoc prompt through the orchestrator instead of the working agent. |

## Running it

Developer mode on, then the Developer menu's "Open Instrument 2.0 Window". The first open creates the orchestrator task, named "Instrument", in the workspace; it and the tasks it creates appear in the main window's task list, which is the escape hatch into any of them.

Folders reach the orchestrator the way they reach any task: attach one to the conversation with the composer's plus button. It passes them to tasks by mount name with `--folder <name>[:rw]`.

## What the first run showed

Three messages typed in a row without waiting: a camera search, a landlord reply, and a correction to the camera search. The orchestrator answered each within a few seconds, created two tasks, sent the correction into the running one, and relayed the landlord draft when that task finished, about fifteen seconds after it was asked for. Before the queue drain, the second message was lost; before the heredoc, the price in the brief was corrupted.

A second run: a five-chapter story, with "make it about a submarine captain instead" typed ten seconds later. The correction reached the child between its write steps, and it rewrote all five chapters inside the same turn. A folder attached to the conversation with "tidy this up" became a task with the folder writable, and the files moved on disk.

## Open

- A boot note. Children mid-flight when the app quit are stopped like any task, and nothing tells the orchestrator. Planned as one `data-taskEvent` at boot naming them.
- Standing folder grants. The conversation's attachments stand in. The orchestrator can only ask the user to attach a folder it does not have.
- Assistant text outside `reply` is still drawn. The prompt keeps the model from writing any; the renderer does not yet hide it.
- The children list is titles and ids. Status and a way into a child from this window are not there.
- The wake reports every child finish as `done`; an errored turn is not told apart.
