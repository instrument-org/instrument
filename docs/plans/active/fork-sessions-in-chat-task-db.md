# Plan: fork sessions in the chat's own task.db

Status: proposed, not started.

A task started by `task new` (or by fork on interrupt) is a fork of its chat: it inherits the chat's conversation and works in the chat's folder. On disk it is still laid out like a task with a folder of its own, `chats/<c>/tasks/<t>/`, which holds nothing but `.instrument/`. This plan moves a fork's session into the chat's `.instrument/task.db` and drops the record folder, so a chat and its forks are one folder and one database.

## What a fork's record folder holds today

- `.instrument/settings.json`: `name`, `fork: true`, `workdir: <chat id>`, `createdAt`, `createdWithAppVersion`, `lastActivityAt`, `reasoningEffort` copied from the chat, `forkedOnInterrupt` when fork on interrupt made it, and under `state` the tabs `task new --tab` handed it (`browserTabs`, written by `startFork` in `lib/shell-commands/task/fork.ts`).
- `.instrument/task.db`: one session holding a copy of the chat's messages, each marked `inherited` (`inheritConversation` in the same file), then the fork's own turns.
- No scaffold: `initializeTask` skips `scaffoldWorkFolder` when `workdir` is set (`lib/initialize-task.ts`).

## What reads it

- **Record index**: `lib/record-folders.ts` learns a chat's tasks from its `tasks/` folder: `chatTaskIds`, `chatTaskDirs`, `resolveRecord`, `recordDir`, `placeTask`, `recordIdTaken`.
- **Working folder**: `lib/work-dir.ts` (`workDir`, `hasOwnWorkFolder`, `chatPathOfWorkDir`) reads `workdir` from the record through `readWorkdirSync`. `task folder --add` reads `fork` to grant the chat's running forks (`lib/shell-commands/task/folder.ts`).
- **Child lists**: `listChildTasks` and `childTaskMounts` (`lib/chat/children.ts`), and through them the `chats.*` routes (`childTasks` in `rpc/routes/chats.ts`, which also returns each task's `dir`), `chatActivity` (`lib/chat/activity.ts`), `chatFor` in `lib/chat/chats.ts`, `lib/chat/window-tab.ts`, and `windowTaskMounts`, which mounts every chat task folder for the window, forks' empty ones included.
- **Wake and interrupt**: `lib/chat/wake.ts` (the overdue sweep lists running children per chat) and `lib/fork-on-interrupt.ts` (`chatTaskIds(chatId).filter(isWorking)`).
- **The `task` command**: `show` and `send` read settings and state by `taskDir(id)`; `list` goes through `listChildTasks`; `log` takes the task's newest session with `latestSessionId(id)` (`lib/chat/latest-session.ts`), which in a shared database would have to pick the fork's session rather than the chat's; `children.ts` resolves a near-miss id from `listChildTasks`.
- **Delete**: `lib/trash-task.ts` walks `chatTaskIds` to take a chat's tasks with it.
- **Store**: `Store` opens a database by task id; a fork's id resolves to its own folder's `task.db`. A store already holds several sessions (`Store.getSessions`, `latestSessionId`), so the chat's database can hold a fork's session beside its own.

## Steps

1. **Session.** `startFork` creates the fork's session in the chat's store rather than its own. The inherited copy can stay a copy at first; referencing the chat's messages up to the fork point is a later saving.
2. **Record.** A fork's settings and state move into the chat's record, keyed by fork id. Decide between the chat's `settings.json` and rows in the chat's database; the database is the safer home, since several forks update `lastActivityAt` and state while the chat does, and the JSON record is one file.
3. **Index.** `record-folders.ts` lists a chat's forks from that record instead of from `tasks/`, and `resolveRecord` returns them as tasks of the chat. Anything that takes `taskDir(forkId)` for the record (settings, state, store) goes through the index to the chat's folder; anything that takes it for files already goes through `workDir`.
4. **Drop the fork flags.** With every fork in the chat's record, a folder under `chats/<c>/tasks/` is a briefed task from an older version and nothing else. `fork` and `workdir` leave `TaskSettingsSchema`, and `hasOwnWorkFolder` becomes "is it a folder under `tasks/`".
5. **Callers.** `childTasks` stops returning a `dir` for a fork (it names an empty folder today); `windowTaskMounts` mounts only briefed tasks' folders; trash deletes fork rows with the chat.
6. **Migration.** A layout sweep (bump `WORKSPACE_LAYOUT_VERSION` in `lib/migrate-workspace-layout.ts`) folds each existing fork folder into its chat: copy its session and rows into the chat's database, write its record entry, then remove the folder. A briefed task's folder is left as it is.

## Not in scope

The live session actor, `isWorking`, wake events and RPC inputs all key on the fork's task id, which stays the same; only where the id resolves to changes.
