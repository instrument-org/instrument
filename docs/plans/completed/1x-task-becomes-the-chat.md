# Plan: a 1.x task becomes the chat

Status: built. The task folder is the chat; the chat's conversation is a text-only rewrite of the task's session rather than the session itself (see "As built").

A 1.x task was one agent talking with the user in its own folder, which is what a chat is now. The migration still treats it the way the delegating chat needed: a new chat that holds a text-only copy of the conversation, with the real task, its tools and its files, filed under it as a briefed task. This plan makes the 1.x task's session and folder become the chat itself.

## What the migration does today

`migrateLegacyTasks` (`packages/workspace/src/lib/migrate-legacy-tasks.ts`) runs from `migrateWorkspaceLayout` (`lib/migrate-workspace-layout.ts`) after the task sweep, once per `WORKSPACE_LAYOUT_VERSION`. For each folder under the root `tasks/` that `isLegacyTask` accepts (no `parentTaskId`, no `chatSessionId`, not a project), `adoptTask`:

- sets aside the tutorial replay and any task with no user message under `.pre-chats/empty-tasks/`;
- stages a new chat folder (`.instrument/` and `attachments/` only), named by `chatFolderName` from the task's title and date, with a fresh `ses_` session id;
- writes the chat's settings: `chatSessionId`, dates, name, and under `state` the task's attached folders (`chatFoldersOf`) and selected model;
- clones the user's attachments into the chat (`copyAttachments`);
- writes the chat's database with `writeChatRows`: every message with its words only (no tool calls, no reasoning), assistant text rewritten so task paths point at `/tasks/<id>/` (`translateTaskFolderPaths` and the relative-link rewrite), and a `data-adoptedTask` part on the first user message naming the task and the files it made (`heldFiles`);
- moves the task folder, untouched, to `chats/<chat>/tasks/<id>/`, then gives the staged chat its real name (`finishStagedChat`).

Projects become topics (`topicForProject`) and their folders are set aside under `.pre-chats/projects/`. `markSeen` writes each chat's seen mark from the task's unread state.

What that leaves: the task has no `workdir`, so it is a briefed task. Its folder is mounted read-only in the chat at `/tasks/<id>` (`childTaskMounts`, `lib/chat/children.ts`), the chat's agent is told to carry on with `task send <id>` (`adoptedTaskModelNote`, `lib/adopted-task-model-text.ts`), and the chat's own folder gets the template scaffold the first time its agent starts (`ensureWorkFolder`, `lib/initialize-task.ts`). A follow-up therefore runs either in a chat that cannot write the task's files, or in the old task behind the chat, two hops from the user.

## The change

`adoptTask` makes the task folder the chat:

- **Folder.** The task folder moves to `chats/<chat>/` itself rather than under `tasks/`. Its `work/`, outputs and attachments are the chat's working folder, so the agent sees them at `/task` exactly where the 1.x transcript says they are, and no path rewrite is needed.
- **Session.** The task's own `task.db` session becomes the chat's: `chatSessionId` is set to the task's newest session id rather than a fresh one, and the session keeps every tool call and result. Its stored baseline carries an older system prompt, so `prepare-model-messages.ts` rebuilds it under the `instrument` agent on the first turn, as it does for any older session.
- **Settings.** The task's `settings.json` is rewritten in place to a chat's: `chatSessionId`, name, dates, the attached folders through `chatFoldersOf`, the selected model; `projectId` becomes the chat's topic as now.
- **Gone:** `writeChatRows`, the path rewrite, `heldFiles`, `copyAttachments`, the `data-adoptedTask` part for new migrations, and the `task send` note. Staging keeps its role of never listing a half-moved chat: rename the task folder to the hidden staging name, rewrite settings, then rename to the chat's name.
- **Kept:** the empty and tutorial set-aside, projects to topics, and `markSeen`.

## Open

- **Already-migrated workspaces.** Every beta workspace has been through today's adoption. A second sweep at a new layout version could collapse a chat whose only child is the adopted task and whose messages are all migration copies (the `data-adoptedTask` part marks it). Whether that is worth doing, or the old shape is left as it is, is undecided; until then `adoptedTaskModelNote` and `childTaskMounts` stay for those chats.
- **Rendering 1.x tool parts.** A 1.x session carries tool parts from tools that no longer exist or have changed shape. The chat hides tool calls outside developer mode, but model-message conversion has to accept them; check against a real 1.x database before relying on it.
- **Session size.** The text-only copy keeps the chat small; the full 1.x session may be large enough that context compaction matters on the first follow-up.

## As built

- **Folder:** as planned. The task folder is staged at `chats/.<name>.partial` and renamed once the chat's database and settings are in place.
- **Session:** not the task's own. The chat's `task.db` is rewritten to one session holding the user's words and files and the replies' words, under their original ids, with no path rewrite. Keeping the 1.x session with its tool calls was the plan, but those tool parts were never checked against today's model conversion, and the text-only copy was already what the delegating chat ran on; the agent reaches the task's files in its own folder either way. The task's `task.db` and `settings.json` move to `.pre-chats/task-records/<chat>/`, so the full session can be recovered.
- **Gone:** `heldFiles`, `copyAttachments`, the path rewrite, the `data-adoptedTask` part and its model note, and the row's reading of it. A wrapper chat an earlier build made keeps its child task; its old part now reads as `data-unknown`, which renders nothing.
