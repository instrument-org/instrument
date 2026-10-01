# Plan: what the classic window took with it

Status: open list. Each item says whether it came back, is not coming back, or is still open.

The 1.x window (`MainWindow`, its sidebar, tab bar, command menu and task page) is gone, and the app window is the only one. This is what it did, what became of each piece, and the edge cases its removal surfaced. Items marked **kept** still have their backend: the route or library is in the tree, only the screen went. Items marked **deleted** would be rebuilt from git history.

Related: [legacy-data-migration.md](legacy-data-migration.md), which turns 1.x tasks and projects into chats and topics.

## 1.x tasks have no screen

The app window lists the tasks its chats started (`workspace.chats.tasks`), and a 1.x task has no chat. With the classic window gone, a person's 1.x tasks and projects are on disk but reachable only by address (`/tasks/<id>`): no list, no search. [legacy-data-migration.md](legacy-data-migration.md) (FP-1309) is what brings them back, as chats and topics, so it has to ship with or before this removal for anyone who used 1.x.

## Features without a counterpart

- **Subscribe page.** Plan picker and checkout. Kept: `plans.get`, `stripe.createCheckoutSession`, `stripe.getInvoicePreview`, `useLiveSubscriptionStatus`. Settings still has the account card and "Manage subscription" (`stripe.createPortalSession`), so a subscriber can manage a plan but nobody can start one from the app. The page itself was only reachable from the dev panel.
- **Export and import a task as a zip.** Deleted: `utils.exportZip`, `workspace.task.exportZip`, `workspace.task.import`, `lib/export-task-zip.ts`, `lib/import-task.ts`. A chat's menu offers "Save transcript" and nothing that takes the files with it. `lib/extract-task-zip.ts` stays for the scripts that read a zip exported by an older build.
- **Open a task in an editor or terminal** (VS Code, Cursor, iTerm and the rest, developer mode). Deleted: `utils.openTaskIn`, `utils.getSupportedEditors`, `shared/schemas/editors.ts`, and the app icons for them.
- **Server exceptions banner.** Back in the app window as a red count beside the dev badge (developer mode), opening the exceptions with copy and clear and a way into Settings' diagnostic log.
- **Per-task usage summary** (tokens across the task). Back in the task page's header in developer mode, from `workspace.task.live.usageSummary`. Usage per reply is gone from the footer on purpose.
- **Background processes control** in the task header: back, as the "still running" pill with a stop for each command.
- **Task search.** Cmd+K searched tasks, projects and debug pages by name. Not coming back as a palette; [chat-search-in-the-omnibar.md](../completed/chat-search-in-the-omnibar.md) proposed finding chats and tasks from the omnibar, superseded once each tab's omnibar was scoped to what that tab holds.
- **Tasks list** with filters and bulk delete. Not coming back: tasks are the chat's to manage, and the Tasks screen lists a chat's tasks, or every chat's.
- **Branch from a message.** Deleted, and not coming back: `workspace.task.branch` and `lib/branch-task.ts`.
- **Keyboard shortcut guide.** Back: `?`, Help > Keyboard Shortcuts, and the omnibar open a searchable guide generated from `shared/window-shortcuts.ts` and `shared/shortcuts.ts`.
- **Welcome modal and tutorial task.** Deleted, and not migrated; to be replaced by a first run designed for the app window.
- **Transcript viewer** (developer mode). Deleted, with `transcript.content`, the route that rendered a transcript for it. "Save transcript" stays in a chat's menu; `/debug/components/transcript` is the chat transcript's component gallery, not a viewer.
- **Chat replay** (developer mode). Deleted: `workspace.debug.replaySession`, `workspace.replay.*`, `lib/session-replay.ts`, and the replay sessions a task's activity reported. The seeder inserts recorded transcripts without re-running them.
- **Pins and unread marks on tasks.** Deleted; tasks are a detail the chat manages and need neither. Chats have their own: `starredAt` on the chat's session, and a seen watermark per chat (`chatSeen` on the window's record). The legacy migration carries 1.x `pinnedAt` over as a star and `unreadIndicator` over as the watermark.
- **Projects.** Topics replace them; the legacy migration makes each project a topic, with its instructions and folders. `workspace.project.byId` stays for the transcript note that names a task's project, and `lib/project.ts` stays for 1.x tasks still in a project and for the migration.

## Edge cases the removal surfaced

- **A notification for a task with no chat only raises the window.** `revealTask` opens the inbox for a chat and does nothing else for a 1.x task, which could open `/tasks/<id>`.
- **Chords cannot be driven over CDP.** Injected keys never reach `before-input-event` or the menu, so Cmd+R, the dialog guard on tab chords, Help > Keyboard Shortcuts and the Developer theme chords were checked by reading only.
