# Plan: one chat, one database

Status: done, steps 1-6 landed (`b834385c7` through the docs commit). Replaces the earlier plan to fold fork sessions into the chat's `task.db`, which kept forks as records. Decision record: [one chat, one database](../../decisions/2026-10-10-one-chat-one-database.md).

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

**Folders.** The home folder stays readable whole, so the agent can try a likely path or search for one. A chat stores only the grants made in it, `grants: [{ path, grantedAt, source: "card" | "attached" }]`: "Allow in this chat" from a permission card (a folder picked from the card included), and a folder the user attached. A grant is always an allow, meaning use the folder, read and write, in that chat only; there is no read-only or read-write choice. A folder's `/mnt/<name>` is derived from its path, never stored, and assigned in `grantedAt` order: an earlier grant keeps its plain name and only a newcomer that collides with it is qualified, so a path the chat already used never moves mid-conversation. A test pins that. Global rules (Allowed, Ask first, Not allowed) are this computer's, in machine preferences, never in the workspace. Across global rules and a chat's grants the deepest path wins, and at an equal path the chat's grant wins. The rules themselves belong to the permissions work (FP-1371). `attachedFolders` on records and the `<attached_folders>` block printed into messages go.

**Tabs.** The chat drives every tab by default. A task drives a tab only when handed one (`task new --tab`) or when it opened one; while it does, the chat leaves that tab alone, and when the task finishes the tab returns to the chat. The user can always use any tab. One driver per tab, so two agents never act in one page at once.

## The task command

`task` only ever acts on the chat's background sessions, never on the chat itself:

```
task new --name '<title>' [--tab <id>] [--job <bg id>] <<'EOF'   prints t1
task send <t id> [--now] <<'EOF'
task stop <t id> [<bg id> | --all]
task list [--running] [--since <date>] [--limit <n>]
task log <t id> [--steps] [--tail <lines>]
```

A task's id is a per-chat handle, `t1`, `t2` in creation order, like a background command's `bg_1`, mapped to its session and never reassigned. `task show` goes: with model, folders and tabs on the chat it only repeated what `list` and `log --steps` give. `task folder --add`, the chat granting itself a folder, moves to the permission card (`request_folder`) with the permissions work.

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

## As built

Where the code differs from the plan above:

- **Model and effort are top-level settings.** `modelURI` and `reasoningEffort` sit at the top of the chat's `settings.json` beside `name` and `grants`, not under `state`; `selectedModelURI` is gone from state. The composer's send writes `modelURI`; a task's message writes nothing, and the `task` command, the wake, retitling and Studio read it from the chat (`ChatInfo.modelURI`). Nothing writes `reasoningEffort` yet.
- **Topics and the chat's marks stay on its session row.** Starred, archived, unread and the topics a chat is filed under live on the chat's session row in `chat.db`, as they did before, not in `settings.json` as the model section lists them.
- **Tabs are held tabs naming a driver.** The chat's `state.browserTabs` lists `{ id, openedBy: "handed" | "task", driver? }`, where `driver` is the task session driving the tab and absent means the chat's own conversation. `task new --tab` takes a tab from the chat and is refused while another working task drives it; when a task's turn ends its tabs go back to the chat, and a returned tab the user closed no longer blocks the chat's browsing. The CDP bridge path carries the chat and the session (`/devtools/task/<chat>/<session>`).
- **`task stop` takes several tasks.** `task stop t1 t2` stops each; with short handles that is how a model wrote "stop everything", and reading the second handle as a process id left the first running.
- **`task folder --add` stays** until the permission card owns folder requests: it grants the folder to the chat with `source: "card"`, the same as an answered `request_folder` card. `task list` also takes `--until` and `--all`.
- **The old `tasks/` dir is masked.** A chat's leftover `tasks/` folder stays on disk, read by nothing, and masked from the agent's `/task` mount so its folders do not sit there writable with their private dirs in view. The `/tasks` mount and everything that pointed the agent at it are gone.
- **What the reach includes.** `folderReach` derives the chat's mounts on every read: the home folder and `~/Documents/Instrument` first, then the grants by `grantedAt`, then the folders of the chat's topics. Home stays read-only whole through `effectiveFolderAccess`, which keeps any folder overlapping the workspace root read-only. Global rules and deepest-path-wins precedence were not built; they belong to the permissions work.
- **A task's handle and status are on its row**, stored once at creation so a handle never changes, rather than derived from creation order.
- **Evals.** Step 5 ran on GLM 5.3 Flash: task-session-start, task-session-steer, handoff-steer, handoff-stop-all, files-fence-shared-folder-deliverable and a new task-session-tab case, plus the eight interruption cases (8/8). A case's folders lost `access`: a committed fixture is copied for every run and only an `inPlace` folder is attached where it is.
