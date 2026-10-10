# Plan: bringing 1.x tasks and projects into chats

Status: migration built (`packages/workspace/src/lib/migrate-legacy-tasks.ts`, first in `3d7504b0f`) and shipped in the 2.0 betas, then reshaped so the 1.x task's folder becomes the chat itself ([1x-task-becomes-the-chat.md](../completed/1x-task-becomes-the-chat.md)); the `visitedHosts` site backfill and the eval are not done. Phase 2 of two; it builds on [chat-folders.md](../completed/chat-folders.md).

## Goal

Everything a 1.x user made shows up in the 2.0 window as ordinary chats. Their projects become topics, and a follow-up in an old chat carries on. The goal is best effort, not fidelity: this runs for beta testers first. The migration introduces no new UI, and an adopted chat looks and behaves like any other.

## What 1.x left on disk

Figures from one real workspace, as a scale guide:

- **Tasks:** 294 top-level tasks with messages (app 1.0 to 1.6), plus 11 with none. Each is a normal task folder with a single `task.db`.
- **Same agent as a 2.0 child task.** They run `agents/main.ts`, the same file a 2.0 child task runs: the user-facing branch, chosen because `parentTaskId` is unset. The tool mix is the same, and they are smaller: a median of 7 tool calls per task, against 24 for 2.0 child tasks. 162 of the 294 are a single ask.
- **Projects:** 11 of them in `projects/<name>/`. Each has `.instrument/settings.json` (id, description, folders) and `AGENTS.md` (instructions). 43 tasks point at one through `settings.projectId`. 5 projects have instructions, from 64 to 4,614 characters. 6 have folders.

## The shape of an adopted chat

Each 1.x task becomes a chat: its folder is the chat's folder.

```text
chats/<new chat id>/
  .instrument/task.db       the old conversation's words, as the chat's one session
  .instrument/settings.json the chat's record: its session, the task's name, dates, folders
  work/, output/, attachments/  the task's own files, where they were
```

The task's own `settings.json` and `task.db` move to `.pre-chats/task-records/<chat id>/`.

**What the chat holds, in order:** every user message, then every assistant text part with words, each in the message it came from, under the ids it had. That's all a 2.0 chat shows anyway: tool calls and reasoning never draw in the chat view.

- **Kept:** the user's words and their attachments, and the agent's words, including any `files` fences, unchanged: the files are in the chat's own folder, at `/task`, where the 1.x replies said they were.
- **Not kept in the chat:** tool parts, reasoning, `session-context` messages, and 1.x data parts. They are in the set-aside database.

**Its row and screen:**

- The title is the task's `name`.
- `createdAt` and `updatedAt` come from the task's settings, so the inbox orders it by when it was last active.
- The preview is the last answer's first line, as for any chat.
- The chat opens as bubbles, and a 1.x answer can be long. That's accepted.

On the real workspace, a median adopted chat is 3 bubbles and a p90 one is 12. The agent's words come to a median of 392 characters per task and a p90 of 6,963.

**Continuing it:** you type in the chat, and the one agent answers with the old words in its history and the task's files in its own folder.

## Files and sites on the row

Best effort, from what 1.x recorded. None of it is required for the chat to work.

- **Files.**
  - Fences kept with the answers count with no extra work, since `filesHeld` reads fences in the chat's replies (78 tasks).
  - Files a 1.x task recorded only in `data-fileChanges` are not listed on the row; they are in the chat's folder.
- **Sites.**
  - The task's `browser-state` `lastUrl` host (49 tasks) and the hosts of `agent-browser open <url>` commands in its bash calls (62) are written once into its browser state's `visitedHosts`.
  - Together that's 91 of 294 tasks. It's a floor, because 1.x didn't record visits.
- **Apps.** None: 1.x had no connected apps.

## Projects become topics

- **Name and mark.** A leading emoji in the project's folder name becomes the topic's emoji and comes off the name. Any other project gets no emoji: `TopicFace` already draws the first letter (`topic-mark.tsx`), and `topicColor` already derives a color from the name.
- **Merge by name.** A project whose name matches an existing topic (ignoring case and the leading emoji) merges into that topic, and the topic keeps its emoji and color.
- **Instructions.** A non-empty `AGENTS.md` becomes the topic's `instructions.md` (for a merged topic, it's added after the instructions the topic already has). They reach the chat's agent in the topic note on each message.
- **Project folders become the topic's folders.** Each path in the project's `folders` (a bare path, or a path with its access) is a topic folder by path; access is dropped. A message sent in a chat carrying the topic attaches them to the chat. The `/project` mount is dropped.
- **Membership.** Every task with `projectId` gives its adopted chat that topic. `projectId` is then cleared.
- **`projects/`** moves to `.pre-chats/projects/`.

## Migration

This is the layout version after [chat-folders.md](../completed/chat-folders.md)'s, in `migrate-workspace-layout.ts`. It's raw files and `node:sqlite`, and idempotent step by step.

1. Projects to topics, as above, so the topics exist before the chats that carry them.
2. Tasks with no user message go to the trash.
3. For each remaining task under `tasks/` (the folder it is in is what makes it a task no chat owns):
   1. Write the chat's database and settings beside the task's own.
   2. Move the task folder to the chat's name, hidden while staged.
   3. Set the task's database and settings aside, put the chat's in their place, and give the folder its real name.

   This also covers any parentless task a 2.0 build made, such as the tutorial task.
4. Tasks with more than one session (7 on the real workspace) copy every session's words in order, into the one chat session.
5. Write the marker.

## As built

Where `migrate-legacy-tasks.ts` differs from the above, or adds to it:

- **Runs once per layout version**, inside `migrateWorkspaceLayout`'s sweep behind the `.layout-version` marker, and decides from the data: a task under `tasks/` whose settings name neither a chat's session nor a chat that started it (fields only a 2.0 build wrote), or a project under `projects/`, is work to do. The marker is written only when nothing is left over, so a boot cut short or a task that failed to move is retried on the next one. A 1.x build writing to the workspace after the sweep is not caught until the next version bump; supporting that is not worth a scan on every boot.
- **Staged chats.** The task folder moves to `chats/.<name>.partial` with the chat's database and settings written beside its own, and is renamed only once they are in place, so no chat is listed half made. A boot cut short finishes each step not yet done.
- **Unread and pins carry over.** Each chat's `chatSeen` mark goes into the window's state, `.instrument/window.json`, before any chat is listed: read up to its newest message, or one short of its newest reply where 1.x had `unreadIndicator`. `pinnedAt` becomes the session's `starredAt`.
- **Set aside, not trashed.** Tasks with no user message, and the tutorial replay (its assistant turns name the `tutorial-task-replay` model), move to `.pre-chats/empty-tasks/`. A task with a database and no settings file counts as a task.
- **Project folders become the chat's.** The task's folders, project-lent ones included, are the chat's own, under the names the task knew them by.
- **Replies keep their steps.** Each 1.x assistant message with words stays its own message, marked finished so it counts as a reply. Tool-only steps are dropped. Paths are left as written, since the task's folder is the chat's.
- **Rows are written as text.** The store refuses a row it reads back as bytes.
- **Not done:** the `visitedHosts` backfill for sites, and the eval.
- **Left in place:** task folders whose names are not valid task ids (seen only in a dev workspace, all empty), and settings files that do not parse.

## Checks

- Unit tests on a fixture holding a single-ask task, a multi-ask task with attachments, a multi-session task, a task in a project with instructions, a project whose name starts with an emoji, a project that matches an existing topic, and an empty task.
- An eval (`pnpm eval run`) on an adopted fixture chat, with a follow-up that needs the old task's files. It checks that the agent works on them in place rather than starting over, and that its reply length isn't pulled toward the long 1.x answers in its history. Run it on GLM and one GPT model.
- Boot Studio on the migrated fixture: adopted chats sit in the inbox by last activity with their topics, open as bubbles, and continue.
