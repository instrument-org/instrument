# Plan: chats as folders that own their tasks

Status: landed. Chats have folders of their own, with their tasks inside, a Delete chat in their own menu, and a boot migration from the one-conversation layout. Not in it: the thread-to-chat rename, and topic instructions reaching the agent, which [legacy-data-migration.md](../active/legacy-data-migration.md) (phase 2) takes on.

## Problem

The 2.0 window's data had the shape of its first prototype. One orchestrator task, `tasks/instrument/`, stood in for every chat: all chats were sessions in its one `task.db`. Its `settings.json` held every cross-chat map (topics, seen marks, which chat started which task, which chat connected which app, the folder grants, and the dead channel-era keys). The tasks those chats started sat flat in `tasks/` beside every other task. What said which chat owns a task was a key in the orchestrator's state (`taskThreads`, and `taskChannels` for tasks from the channels era).

What that cost:

- **Nothing could delete a chat.** Archive existed and delete did not. A delete would have had to find its tasks through a side map, tear each one down, and cut its session out of a shared database.
- **Ownership could drift.** The link from a task to its chat was a pointer in another record, not a fact about the task.
- **Every chat shared one of everything.** One database file for every write, and one `attachments/` folder for every pasted file.
- **`/tasks` showed every chat's tasks to every chat.** `childTaskMounts` mounted all of the orchestrator's children.

On one real workspace this was 38 chat sessions (13 from the channels era, 25 threads) in a 9.1 MB database, and 64 child tasks, every one of which maps to a chat through one of the two maps.

## The layout

```text
workspace/
  chats/
    2026-09-24-transcribe-20-minute/
      .instrument/
        task.db            this chat's one session and its messages
        settings.json      the session it holds, kind, name, dates, model, folder grants
      attachments/         files sent in this chat
      tasks/
        <task id>/         a task this chat started, in the task layout it has today
  topics/
    <topic id>/
      topic.md             front matter: name, emoji, color, about; body: instructions
  tasks/
    instrument/            the window's own record (below)
    <task id>/             a task no chat owns: from 1.x until phase 2 adopts it
  memory/  apps/  skills/  projects/
```

- **A chat's folder is named the way a task's is**: the day it began and up to 24 characters of its first words, shorter than a task's 40 because a chat's tasks nest inside it and a deep path inside a task has to fit around both names. Its settings name the session it holds (`chatSessionId`), and the folder index maps a session to its chat and back; the window asks `orchestrator.chats.of` for a thread's record, and each listed thread carries its `chatId`.
- **A chat's record is made before the window shows it.** `orchestrator.chats.ensure` runs at the draft's send, and only there: `message.create` takes the chat's record id and never makes one. Drafts stay in window storage, so a chat folder exists only once something was sent, though a send that fails after `ensure` leaves a chat folder with no messages in it.
- **The folder is the owner.** A task belongs to the chat whose `tasks/` holds it, and `parentTaskId` names the chat. `taskThreads` and `taskChannels` are gone.
- **Task folders keep their names.** They stay dated and readable, and ids stay unique across the whole workspace: `generate-task-folder-name` and `new-task-id` check inside every chat too.
- **A chat's record reuses the task record.** Same `.instrument/{task.db,settings.json}`, same Store, same session store, same per-session actor, `kind: "orchestrator"` in settings (renamed with the rest of the thread vocabulary), and one session per chat. A chat takes none of a task's scaffold.
- **The window keeps a record of its own**, `tasks/instrument/`, for what belongs to the window rather than a chat: the pages its browser has open (tab targets are keyed to it), the tab on screen that a chat's `agent-browser` drives, what the user has seen in each chat (`threadSeen`), which chat an app was asked for in (`appThreads`), and the folders granted before any chat asked. It holds no sessions.
- **Folder grants are per chat, starting from all of them.** A new chat starts with every folder the window or any chat holds, at the widest access any was given, so a grant still reads as the user's answer for the app. A folder granted later in one chat reaches the chats made after it, not the ones already open.
- **Topics are workspace-level folders**, beside `memory/`, each holding a `topic.md` named by the topic's id, so renaming a topic moves no folder. The folder leaves room for reference files later; nothing mounts it yet.

## Resolving a folder from an id

`taskDir(id)` resolves through `record-folders.ts`: an in-memory index read on first use from `chats/*` (each chat's settings name its session) and `chats/*/tasks/*`, kept current by `initializeTask` and `trashTask`/`trashChat`; anything not in it is flat under `tasks/`. An id is reserved in the index the moment a chat or a task inside one is made, so two chats picking the same dated name are refused rather than both writing folders. `getTasks` lists chats, their tasks, and the flat tasks. Everything keyed by task id (the asset origin, RPC routes, the `task` command, browser state, background processes) works unchanged.

## What changes for the agent

- **`/tasks` holds this chat's tasks only.** `childTaskMounts(chat)` mounts `chats/<id>/tasks/*`. Asked of the window's record, it holds every chat's tasks, since the window opens a path into any of them.
- **Reach stays as it was.** A chat reads any chat's tasks (`task show`, `task log`) and steers only its own (`send`, `stop`, `kill`, `folder`, `app`, `tab`, `wake`); `chat read` and `chat search` read any chat. No prompt text changed.
- **A finished task wakes its own chat**, found from its parent, and never the window's record. An app's event wakes the chat it was asked for in, or the newest chat that has run when that chat is gone.
- **Topics reach the agent the way they did** (`data-threadTopics`), read from the files. How instructions reach the agent and its tasks is phase 2.

## Deleting a chat

`orchestrator.chats.trash` stops the chat's own agent and refuses it new messages, then stops each of the chat's tasks the way trashing it alone does (browser reaped, background processes killed, store let go) without moving its folder, then trashes the chat's folder, which holds them all, in one piece. The chat's own menu (beside its title, not on inbox rows) offers it behind a confirmation naming the chat and its tasks.

## Migration

`migrateToChats` runs at the end of the boot layout migration, on raw files and `node:sqlite`, with no store open. It decides from the data rather than from a marker: a window record whose database still holds a chat session, or whose state still names the old maps, is moved; anything else is left alone. So a workspace an older beta wrote to again is caught on the next boot.

1. Copy the window's `.instrument/` aside to `.pre-chats/<window id>/`, whole or not at all.
2. Every top-level session becomes a chat folder named by its session's day and title: its settings (naming the session) first, so a rerun finds it, then its rows (every key whose second segment is the session, and a sub-agent session's under its top-level one) and the store's version row, in one transaction. A session whose id the store would not read keeps its rows in the window.
3. Each task `taskThreads` or `taskChannels` names moves into its chat, folder first and settings after, and every task in a chat is made to name it.
4. A file in the window's `attachments/` moves to the chat whose messages name it as a whole path segment; spilled command output in `.tool-output/` moves to the chat holding the part it was written for.
5. Each topic is written as `topics/<id>/topic.md`.
6. Last, the rows of the chats that were written leave the window's database in one transaction, and its state drops the channel-era keys, the topics once all are written, and the task maps once every task in them moved.

Each item moves on its own: one that fails (a folder another program holds open) is counted, logged at boot, and left for the next boot, and the rest go on. On a copy of a real workspace it made 38 chats, moved 64 tasks and wrote 8 topics in under a second, a second run changed nothing, and the thread list read afterwards matched the one read before field for field, except for the order of site icons. `.pre-chats/` should be deleted by a later release.

## Rename

`thread` becomes `chat` in code, routes, RPC, the settings kind, and the agent's command (`chat threads` becomes `chat list`), in commits of its own. It touches most of the 2.0 window's files, so it lands after the branches working in them have merged. User-facing copy already says chat.

## Not in this plan

- Tasks from 1.x and projects: [legacy-data-migration.md](../active/legacy-data-migration.md).
- Cross-chat reach beyond what exists (archiving or steering other chats, topic-wide chats, chats messaging chats). The layout decides who owns a task, not who can reach one: the index resolves any id anywhere, so wider reach is a permission on the `task` and `chat` commands when it's wanted.
- A single conversation store or search index across chats: [conversation-storage.md](conversation-storage.md). Per-chat databases are what that plan's fan-out measurements assume.

## Checks

- Unit: `record-folders.test.ts` (placement, a fresh index from disk, id uniqueness), `trash-chat.test.ts`, `migrate-to-chats.test.ts` (layout, a second run, a later write in the old layout), and the thread, chat-command and task-command suites moved onto chat records.
- A disposable Studio instance booted on a pre-migration copy of a real workspace: the migration ran at boot, the inbox listed every chat with its topics, files, apps and sites, and a chat opened with its whole transcript.
- `pnpm eval run` on orchestrator cases that make a file, steer a running task, and hand a sent file to a task.
