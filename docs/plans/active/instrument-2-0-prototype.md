# Plan: the Instrument 2.0 orchestrator spike

Status: second iteration built and running behind developer mode. Design context is the "Instrument 2.0 - Prototype Handoff" note and the tenets it points to; this file records what the code does and what is still open.

## What it is

One agent the user talks to, which never does the work. It creates tasks, each run by the working agent with its own tools, folder, browser, and model, and it keeps one conversation answering while they run. The user sees replies and links; tasks are the machinery behind them.

The spike changes nothing the current app does. It adds a task kind, an agent, two tools, a shell command, a wake, and a second window, and it reuses the session machine, the sandbox, the browser pool, and the chat stream as they stand.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Task kind and parent | `schemas/task-kind.ts`, `schemas/task-settings.ts` | `kind: "orchestrator"` marks the task the user talks to; `parentTaskId` marks a task it created. Both absent on every task a person made. |
| The `instrument` agent | `agents/instrument.ts` | Four tools: bash, `read_file`, `choose`, `request_folder`. No writing, web, browser, or native binaries. Its prompt carries the dispatcher rules: reply first, delegate everything, never wait on a task, one thread over many tasks. What it says is its assistant text, rendered like any agent's, files fence included. |
| `request_folder` | `tools/request-folder.ts`, `message-part/tool-request-folder.tsx` | An interactive call: the turn waits, the card offers the Mac's own folder dialog, the folder is attached to the conversation with the access the agent asked for, and the call answers with the mount name. The agent never sees the host path. |
| Answering a waiting call | `rpc/routes/session.ts` `answerToolCall`, `task/state.ts` `attachFolder` | The route that resolves a `choose` or a `request_folder` from the renderer. Nothing could answer one before. |
| The `task` command | `lib/shell-commands/task.ts` | `new`, `send`, `stop`, `list`, `show`, `log`, `model`, `models`, `wait`, `archive`, scoped to the calling orchestrator's children. `new` and `send` take the brief on stdin through a quoted heredoc, because a `$800` inside double quotes reaches the command as `00`. `show` reports time and tokens spent; `models` lists what is available with context sizes. |
| The orchestrator's sandbox | `lib/create-bash-env.ts` (`orchestrator` option) | Builtins, `rg`, `task`, and the job commands. Children mount read-only at `/tasks/<id>`; attached folders at `/mnt` as usual. The asset origin resolves the same mounts, so a files fence naming a child's output previews. |
| The wake | `lib/orchestrator/wake.ts` | One subscriber on `session.done`. A child of an orchestrator finishing a turn becomes a `data-taskEvent` part on a text-less user message in the orchestrator's session, carrying the child's last words, how long it worked, and tokens spent, debounced so several finishing together arrive as one note naming all of them. |
| Queue drain | `machines/session.ts` | A turn that ends goes to `ProcessingQueuedMessages` rather than `Done`, so a message that arrived mid-turn runs next instead of being dropped. This is what lets the orchestrator's composer stay open while it works, and what makes `task send` into a busy child land at all. |
| Steering between steps | `machines/agent.ts` (`MaybeSteering`), `machines/session.ts` | A message that arrives while a turn runs is handed to the agent, which writes it into the transcript at its next point between steps and continues, so the next request sees it. The session keeps it queued until the agent says it consumed it, so a turn that ends first still runs it as a turn of its own. |
| Which agent answers | `lib/agent-name-for-task.ts` | Read from the task record where a message is sent, so any surface that sends to an orchestrator runs the orchestrator's agent. |
| The window | `apps/studio/src/electron-main/windows/orchestrator.ts`, `client/routes/orchestrator/index.tsx` | A second window on the renderer bundle, the way onboarding is. The human's side on the left, the conversation on the right: a Computer tab and a Tasks tab, and the task page's chat with the sidebar and pane left behind, always submittable. The header says when the orchestrator or its tasks are working. Opened from the Developer menu ("Open Instrument 2.0 Window", Cmd+Shift+I) or the `orchestrator.openWindow` route. |
| The folder view | `client/components/orchestrator/folder-view.tsx`, `lib/orchestrator/list-folder.ts` | The Computer tab: the folders the conversation can reach, browsed like a file browser over the same layout the agent's tools resolve against. Breadcrumbs, a Finder-style list with kind, size and date, double-click to open in the Mac's own app, Show in Finder, and Add folder, which attaches one writable. Re-read every few seconds so a task's files appear as they land. |
| What is on screen | `data-viewContext`, `lib/view-context-model-text.ts` | The folder open in the view and what is selected ride along with every message sent from the window, as a note the model reads, so "this folder", "here" and "these" mean what the user is looking at. |
| The workspace folder | `lib/orchestrator/output-folder.ts` | `~/Documents/Instrument`, created on first open and attached writable to the conversation. Where outcomes land when nobody named a place, in a subfolder per job, and where the folder view opens. A task's own `output/` is scratch. |
| The Tasks tab | `client/routes/orchestrator/index.tsx` | The tasks the orchestrator created, a spinner on each at work, and any one of them open beneath the list with its own chat: the escape hatch. |
| Evals | `evals/cli.ts` `--orchestrator` | Runs an ad-hoc prompt through the orchestrator instead of the working agent. |

## Running it

Developer mode on, then the Developer menu's "Open Instrument 2.0 Window". The first open creates the orchestrator task, named "Instrument", in the workspace; it and the tasks it creates appear in the main window's task list too.

Folders reach the orchestrator two ways: attach one to the conversation with the composer's plus button, or let it ask with `request_folder` when the work needs one it does not have. It passes them to tasks by mount name with `--folder <name>[:rw]`.

## What the runs showed

Three messages typed in a row without waiting: a camera search, a landlord reply, and a correction to the camera search. The orchestrator answered each within a few seconds, created two tasks, sent the correction into the running one, and relayed the landlord draft when that task finished, about fifteen seconds after it was asked for. Before the queue drain, the second message was lost; before the heredoc, the price in the brief was corrupted.

A five-chapter story, with "make it about a submarine captain instead" typed ten seconds later: the correction reached the child between its write steps, and it rewrote all five chapters inside the same turn. A folder attached to the conversation with "tidy this up" became a task with the folder writable, and the files moved on disk.

A note asked for in a folder the orchestrator did not have: it asked for the folder, the answer attached one, the task ran with it, and the reply carried the file in a files fence that rendered as a preview.

The first iteration had a `reply` tool as the orchestrator's only voice, capped and markdown-free. Models called it and then wrote the same text again as assistant text, and the cap fought the answers that earned more room, so assistant text is the voice and the tool is gone.

With the folder view open on the workspace folder, "write a haiku about autumn into a file in this folder" became a task handed that folder writable; the file appeared in the view as it landed, and the reply previewed it.

## Open

- A boot note. Children mid-flight when the app quit are stopped like any task, and nothing tells the orchestrator. Planned as one `data-taskEvent` at boot naming them.
- Standing folder grants. The conversation's attachments stand in, and `request_folder` asks for one at a time.
- The wake reports every child finish as `done`; an errored turn is not told apart.
- The stop button still shows in the composer while the orchestrator's turn runs, though the conversation never has to wait on it.
- The folder view is a list. No previews, no drag in, no rename or delete, no search; the browser tab beside it does not exist yet.
- The workspace folder is fixed at `~/Documents/Instrument`; the user cannot yet move it.
