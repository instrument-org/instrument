# Plan: what the classic window took with it

Status: open list, nothing scheduled. Each item is small enough to pick up on its own.

The 1.x window (`MainWindow`, its sidebar, tab bar, command menu and task page) is gone, and the app window is the only one. This is what it did that the app window does not, and the edge cases its removal surfaced. Items marked **kept** still have their backend: the route or library is in the tree, only the screen went. Items marked **deleted** would be rebuilt from git history.

Related: [legacy-data-migration.md](legacy-data-migration.md), which turns 1.x tasks and projects into chats and topics.

## 1.x tasks have no screen

The app window lists the tasks its chats started (`workspace.chats.tasks`), and a 1.x task has no chat. With the classic window gone, a person's 1.x tasks and projects are on disk but reachable only by address (`/tasks/<id>`): no list, no search. [legacy-data-migration.md](legacy-data-migration.md) (FP-1309) is what brings them back, as chats and topics, so it has to ship with or before this removal for anyone who used 1.x.

## Features without a counterpart

- **Subscribe page.** Plan picker and checkout. Kept: `plans.get`, `stripe.createCheckoutSession`, `stripe.getInvoicePreview`, `useLiveSubscriptionStatus`. Settings still has the account card and "Manage subscription" (`stripe.createPortalSession`), so a subscriber can manage a plan but nobody can start one from the app. The page itself was only reachable from the dev panel.
- **Export and import a task as a zip.** Deleted: `utils.exportZip`, `workspace.task.exportZip`, `workspace.task.import`, `lib/export-task-zip.ts`, `lib/import-task.ts`. A chat's menu offers "Save transcript" and nothing that takes the files with it. `lib/extract-task-zip.ts` stays for the scripts that read a zip exported by an older build.
- **Open a task in an editor or terminal** (VS Code, Cursor, iTerm and the rest, developer mode). Kept: `utils.openTaskIn`, `utils.getSupportedEditors`, `shared/schemas/editors.ts`. The app icons for them were deleted.
- **Server exceptions banner.** Main-process exceptions listed in the window with copy and clear. Kept: `utils.live.serverExceptions`, `utils.clearExceptions`. Nothing in the app window shows them.
- **Per-task usage summary** (tokens and cost across the task). Kept: `workspace.task.usageSummary` and its live twin. A turn's footer still shows the turn's own usage.
- **Background processes control** in the task header: what the agent left running, with a stop per process. The data is kept (`useTaskBackgroundProcesses`, which the transcript still reads); the header control was deleted. The chat's task list stops a whole task, not one process.
- **Task search.** Cmd+K searched tasks, projects and debug pages by name. The omnibar searches places, recents and commands, not tasks.
- **Tasks list** with filters and bulk delete. The app window's Tasks screen lists a chat's tasks, or every chat's, without either.
- **Branch from a message.** A new task holding the conversation up to that turn. Deleted: `workspace.task.branch` and `lib/branch-task.ts`. A chat has no equivalent, and a branch would need a chat to belong to.
- **Keyboard shortcut guide** (`?` and Help > Keyboard Shortcuts), searchable, generated from the shortcut table. Deleted. The app window's chords are in `shared/window-shortcuts.ts`, which could feed a guide the same way.
- **Welcome modal and tutorial task.** Deleted, and not migrated; the tutorial is to be rebuilt or rethought for the app window.
- **Transcript viewer** (developer mode). Deleted, with `transcript.content`, the route that rendered a transcript for it. "Save transcript" stays in a chat's menu; `/debug/components/transcript` is the chat transcript's component gallery, not a viewer.
- **Chat replay** (developer mode). Deleted: `workspace.debug.replaySession`, `workspace.replay.*`, `lib/session-replay.ts`, and the replay sessions a task's activity reported. The seeder inserts recorded transcripts without re-running them.
- **Pins and unread marks on tasks.** Deleted, along with the settings write every finished turn paid for the mark. Chats have their own: `starredAt` on the chat's session, and a seen watermark per chat (`chatSeen` on the window's record) that counts settled replies after it. The keys stay in 1.x settings files, and the legacy migration carries `pinnedAt` over as a star and `unreadIndicator` over as the watermark; every adopted chat needs a watermark, or all of its replies count as unread.
- **Projects.** Creating, editing and filing tasks into projects went with their screens; `workspace.project.byId` stays for the transcript note that names a task's project, and `lib/project.ts` stays whole, for 1.x tasks still in a project (their `/project` mount and instructions) and for the migration to topics.

## Edge cases the removal surfaced

- **A notification for a task with no chat only raises the window.** `revealTask` opens the inbox for a chat and does nothing else for a 1.x task, which could open `/tasks/<id>`.
- **A child task's error row offers "Try again" that does nothing.** `ChildTranscript` passes `noop` for `onRunAgain` (and did for the deleted "Start new task" too).
- **The window's command stream does not reconnect.** The classic window's `useAppCommands` resubscribed after a dropped stream (a renderer transport reset); `useWindowCommands` assumes the stream ends only when the window closes.
- **Chords cannot be driven over CDP.** Injected keys never reach `before-input-event` or the menu, so Cmd+R, the dialog guard on tab chords, and the Developer theme chords were checked by reading only.
- **Studio in the browser needs app-window fixtures.** See [studio-in-the-browser.md](../../architecture/studio-in-the-browser.md).
- **A 1.x task still speaks to the user.** `agents/main.ts` picks the reader by `parentTaskId`; a task with none writes for a person rather than for the chat's agent. The migration sets a parent on adoption; until then a 1.x task opened by address keeps its old voice.
