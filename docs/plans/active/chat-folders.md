# Plan: chats as folders that own their tasks

Status: proposal, not started. Phase 1 of two; [legacy-data-migration.md](legacy-data-migration.md) is phase 2 and builds on this one.

## Problem

The 2.0 window's data still has the shape of its first prototype. One orchestrator task, `tasks/instrument/`, stands in for every chat: all chats are sessions in its one `task.db`. Its `settings.json` holds every cross-chat map (topics, seen marks, which chat started which task, which chat connected which app, the folder grants, and the dead channel-era keys). The tasks those chats start sit flat in `tasks/` beside every other task. What says which chat owns a task is a key in the orchestrator's state (`taskThreads`, and `taskChannels` for tasks from the channels era).

What that costs:

- **Nothing can delete a chat.** Archive exists and delete does not. A delete would have to find its tasks through a side map, tear each one down, and cut its session out of a shared database.
- **Ownership can drift.** The link from a task to its chat is a pointer in another record, not a fact about the task.
- **Every chat shares one of everything.** One database file for every write, one `attachments/` folder for every pasted file, and one folder that holds a task scaffold (`package.json`, `work/`, `output/`) no chat uses.
- **`/tasks` shows every chat's tasks to every chat.** `childTaskMounts` mounts all of the orchestrator's children. Each chat can steer only its own tasks (`requireOwnChild` in `shell-commands/task.ts`), but it sees everyone's folders.

On one real workspace this is 38 chat sessions (13 from the channels era, 25 threads) in a 9.1 MB database, and 62 child tasks. Every one of the 62 maps to a chat: 29 through `taskThreads` and 33 through `taskChannels`, with none orphaned.

## The layout

```text
workspace/
  chats/
    <chat id>/
      .instrument/
        task.db            this chat's one session and its messages
        settings.json      kind "chat", name, seen mark, apps, topic ids
      attachments/         files sent in this chat
      tasks/
        <task id>/         a task this chat started, in the task layout it has today
  topics/
    <topic id>/
      topic.md             front matter: name, emoji, color, about; body: instructions
  memory/  apps/  skills/  projects/
```

- **A chat folder is made on its first send, never for a draft.** Drafts stay in window storage as they are today, so an empty chat folder never exists.
- **The folder is the owner.** A task belongs to the chat whose `tasks/` holds it. `taskThreads` and `taskChannels` go away, and so does the rule that a task needs a map entry to know its chat. `parentTaskId` names the chat's id.
- **Task folders keep their names.** They stay dated and readable, and ids stay unique across the whole workspace, since `generate-task-folder-name` already checks that. Ids never carry the chat.
- **A chat's record reuses the task record.** Same `.instrument/{task.db,settings.json}`, same Store, same session store storage, with `kind: "chat"` in settings, one session per chat, and the session id as the chat id. Nothing in `Store`, the session store, or the per-session actor changes because of where the folder lives.
- **Topics are workspace-level folders**, beside `memory/`, each holding a `topic.md`. The folder gives a topic room for reference files later. A task in a chat that carries the topic gets the folder read-only at `/topics/<name>`, so it can read what the topic holds but can never write results into it, and no prompt names it as a place for results. Topic ids stay the ids they have today (`top_…`), so renaming a topic moves no folder and touches no chat.
- **Folder grants become workspace-level**, like today's orchestrator `attachedFolders`, and every chat shares them.

## Resolving a folder from an id

`taskDir(id)` in `task-dir-utils.ts` is `path.join(tasksDir, id)`, a synchronous join that sits behind every task-path lookup. Nesting turns it into a lookup:

- An in-memory index from id to folder, covering chats and tasks. It's built at boot by listing `chats/*` and `chats/*/tasks/*`, a few hundred directory entries. It's updated wherever a record is created, moved, or trashed: `initializeTask`, `importTask`, `branchTask`, `trashTask`, and the chat delete below.
- `taskDir` stays synchronous and reads the index. An id the index lacks is an error, not a guess at the flat path.
- `getTasks` lists from the index instead of from `readdir(tasksDir)`. Callers that filter by `parentTaskId` (`listChildTasks`) read the chat's own `tasks/` instead.

Everything keyed by task id keeps working unchanged once `taskDir` resolves: the asset origin (`assets.<taskId>`), RPC routes, the `task` command, browser state, and background processes.

## What changes for the agent

- **`/tasks` holds this chat's tasks only.** `childTaskMounts` takes the chat and mounts `chats/<id>/tasks/*`. Reach otherwise stays as it is today. A chat steers only its own tasks. Reading another chat's task (`task show`, `task log`) and reading another chat (`chat read`, `chat search`) go through the store by id.
- **The chat agent runs per chat record, not per session of one shared task.** `ensureOrchestrator` and the window's single `taskId` give way to "the chat on screen". Code that assumes one orchestrator task id is where most of this phase's diff lives: `useOrchestrator().taskId`, `orchestrator.*` routes taking `{ id, sessionId }`, `TaskCommandContext.orchestratorTaskId`, `recordAppThread`, and `thread-context.ts`.
- **Topics reach the agent the way they do now** (`data-threadTopics`), read from `topics/*/topic.md`. Instructions reach the chat's agent with the topic, and reach its tasks through the slot project instructions fill today (`build-project-context-text.ts`), cut at the same cap with a line naming the file for the rest (`project-instructions.ts`). The pointer names `/topics/<name>/topic.md`, so a task that meets the cut reads the rest from its read-only mount.

## Deleting a chat

A new `chats.trash` route:

1. Stops the chat's own agent turn, if one is running.
2. Runs `trashTask`'s teardown for each task in `tasks/`: it reaps the task's browser and kills its background processes. The order matters, because both hold files inside the folder.
3. Moves the chat folder to the trash in one step and removes its ids from the index.

## Migration

This runs on every 2.0 install at boot, as a new `WORKSPACE_LAYOUT_VERSION` in `migrate-workspace-layout.ts`. It works on raw files and `node:sqlite` (the database is key-value, see [conversation-storage.md](conversation-storage.md)), so it needs no Store.

1. Copy `tasks/instrument/.instrument/` aside to `.pre-chats/instrument/`.
2. For each session in the orchestrator's `task.db`:
   - Create `chats/<session id>/.instrument/task.db`.
   - Copy every key that belongs to the session: `sessions:<id>`, `messages:<id>:…`, `parts:<id>:…`, and the per-session keys (`browser-state:<id>`, `file-index-baseline:<id>` and the rest).
   - Write `settings.json` with `kind: "chat"`, the session's title as `name`, its `createdAt`, its seen mark from `threadSeen`, and its apps from `appThreads`.
   - Skip sub-agent sessions (those with `parentId`); they travel with their parent chat.
3. Move each child task into the chat that `taskThreads[id] ?? taskChannels[id]` names, and set its `parentTaskId` to that chat.
4. Write each entry of `topics[]` to `topics/<topic id>/topic.md`. Session records already carry topic ids (`Session.topics`), so they need no change.
5. Move `attachedFolders` to workspace settings. Drop `channels`, `appChannels`, and `promptDraft`.
6. Move `tasks/instrument/attachments/*` into the chat whose messages reference each file. A file no message names goes to `.pre-chats/`.
7. Remove `tasks/instrument/`, then write the marker.

The migration is idempotent: each step checks whether its work is already done, so a crash partway reruns cleanly. `.pre-chats/` stays for a release, and a later layout version deletes it.

## Rename

`thread` becomes `chat` in code, routes, RPC, and the agent's command (`chat threads` becomes `chat list`). This lands as its own commits after the layout, so the layout diff reads as layout. User-facing copy already says chat in most places. Search for `thread` and `Thread` under `lib/orchestrator/`, `components/orchestrator/`, and `routes/orchestrator/`.

## Not in this plan

- Tasks from 1.x and projects: [legacy-data-migration.md](legacy-data-migration.md).
- Cross-chat reach beyond what exists today (archiving or steering other chats, topic-wide chats, chats messaging chats). The layout decides who owns a task, not who can reach one: the index resolves any id anywhere, so wider reach is a permission on the `task` and `chat` commands when it's wanted.
- A single conversation store or search index across chats: [conversation-storage.md](conversation-storage.md). Per-chat databases are what that plan's fan-out measurements assume.

## Checks

- Unit: index build and update, `taskDir` against nested folders, migration on a fixture with channel-era and thread-era sessions and child tasks under each, a rerun after a crash at each step, and chat trash with a task holding a background process.
- `pnpm eval run` on an orchestrator scenario that starts a task, sends to it, and reads another chat's task. It confirms `/tasks` scoping and the steering refusal.
- A workspace fixture (`fixtures/workspaces/`) in the pre-migration shape: an orchestrator with channel-era and thread-era sessions, child tasks mapped both ways, and topics. Boot Studio on it with `studio-drive.mjs boot --workspace <fixture>`; every chat should open with its tasks, topics, and file and site icons. Then run the migration once on a copy of a real 2.0 workspace, as the last check before release.
