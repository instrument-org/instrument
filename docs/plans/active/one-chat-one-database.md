# Plan: one chat, one database

Status: accepted, in progress. Replaces the earlier plan to fold fork sessions into the chat's `task.db`, which kept forks as records.

The user talks to one agent in a chat. A chat is the only record: one folder, one settings file, one database. Inside the database are sessions, each a thread of messages and tool calls. The chat's own conversation is the session with no parent; a task is a session the chat started in the background, with the chat's session as its parent. "Task" is a word for that child session in the agent's `task` command and in the UI, and nowhere in storage, so the hierarchy can change later (a task with its own model, a fork of a fork, an edited message as a branch) without a schema change.

## What was measured before this

- One agent doing the work itself is faster than routing work through tasks, and a message typed mid-work joining the running turn beats forking it (interruption evals: 48/48 hard checks with join-by-default against duplicated work in 39/40 runs with the auto-fork).
- A fork that starts from the chat's whole conversation is cheap: its first request reads nearly all of it from the prompt cache, because it sends the same prefix.
- Forks are rare and the agent's choice. Whether models choose them at the right moments is not measured yet.

## The model

**Chat (the only record).** `chats/<id>/`, where `<id>` is the `ChatId`:

- The work folder itself (the scaffold for Node and Python), shared by everything the chat runs, tasks included.
- `.instrument/settings.json`: one value each, for the whole chat. Title, topics, starred / archived / unread, the model and reasoning effort (a default today; a future picker writes it), permission grants made in this chat, and the chat's browser tabs with the session driving each.
- `.instrument/chat.db`: sessions and their messages, nothing else.

**Session.** A row in `chat.db`:

| Column | Meaning |
|---|---|
| `id` | `SessionId` |
| `parentId` | Absent for the chat's conversation; the session it forked from otherwise |
| `forkedAtMessageId` | The parent's last message the child inherits |
| `title`, `createdAt`, `updatedAt`, `status` | What the task list and the header line show |

A child's history is read, never copied: the parent's messages up to `forkedAtMessageId`, then its own. The model sees the same prefix it sees today.

**Ids.** `ChatId` and `SessionId`. `TaskId` goes away. The agent's `task` command addresses a task by its session id or its title.

**Folders.** The home folder stays readable whole, so the agent can try a likely path or search for one. A chat stores only the grants made in it, `grants: [{ path, grantedAt, source: "card" | "attached", mountName? }]`: "Allow in this chat" from a permission card (a folder picked from the card included), and a folder the user attached. A grant is always an allow, meaning use the folder, read and write, in that chat only; there is no read-only or read-write choice. An attached folder's grant keeps the `/mnt/<name>` its messages already use. Global rules (Allowed, Ask first, Not allowed) are this computer's, in machine preferences, never in the workspace. Across global rules and a chat's grants the deepest path wins, and at an equal path the chat's grant wins. The rules themselves belong to the permissions work (FP-1371). `attachedFolders` on records and the `<attached_folders>` block printed into messages go.

**Tabs.** The chat drives every tab by default. A task drives a tab only when handed one (`task new --tab`) or when it opened one; while it does, the chat leaves that tab alone, and when the task finishes the tab returns to the chat. The user can always use any tab. One driver per tab, so two agents never act in one page at once.

## What goes

- Fork folders under `chats/<c>/tasks/` and their databases.
- The copied conversation (`inheritConversation`, the `inherited` message mark).
- `fork`, `workdir`, `forkedOnInterrupt`, `attachedFolders` and `browserTabs` on records; a task's model and effort.
- `TaskId`, and the record lookups (id to folder to database) tasks went through.

## Data on disk

Only Jeremy's and Neil's beta data has 2.0 records. A layout sweep renames each chat's `task.db` to `chat.db` (sidecar files with it). Existing `chats/*/tasks/` folders and the 1.x wrapper chats made before the 1.x migration changed are not migrated: they stay on disk as plain folders the chat can read, nothing indexes them, and every chat still lists and opens. The 1.x migration writes `chat.db` directly.

## Steps

1. Sessions as a tree in the chat's database: `task new` creates a child session in the chat's store with `parentId` and `forkedAtMessageId`; reads compose the inherited prefix; the session actor, wake, stop, `task send/log/list/show` and the child lists key on the session.
2. `TaskId` replaced by `ChatId` and `SessionId`.
3. Chat settings take the model, effort, grants and tab drivers; `attachedFolders` and per-task records go.
4. The `task.db` to `chat.db` sweep, and the 1.x migration writing `chat.db`.
5. Evals on GLM 5.3 Flash: a one-case smoke run first, then cases that start, message, stop, and hand a tab and a running command to a task, a task finishing mid-turn, and the eight interruption cases.
6. CLAUDE.md's terminology and the architecture docs.
