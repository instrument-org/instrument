# Plan: bringing 1.x tasks and projects into chats

Status: proposal, not started. Phase 2 of two; it builds on [chat-folders.md](chat-folders.md).

## Goal

Everything a 1.x user made shows up in the 2.0 window as ordinary chats. Their projects become topics, and a follow-up in an old chat carries on. The goal is best effort, not fidelity: this runs for beta testers first. The migration introduces no new UI, and an adopted chat looks and behaves like any other.

## What 1.x left on disk

Figures from one real workspace, as a scale guide:

- **Tasks:** 294 top-level tasks with messages (app 1.0 to 1.6), plus 11 with none. Each is a normal task folder with a single `task.db`.
- **Same agent as a 2.0 child task.** They run `agents/main.ts`, the same file a 2.0 child task runs: the user-facing branch, chosen because `parentTaskId` is unset. The tool mix is the same, and they are smaller: a median of 7 tool calls per task, against 24 for 2.0 child tasks. 162 of the 294 are a single ask.
- **Projects:** 11 of them in `projects/<name>/`. Each has `.instrument/settings.json` (id, description, folders) and `AGENTS.md` (instructions). 43 tasks point at one through `settings.projectId`. 5 projects have instructions, from 64 to 4,614 characters. 6 have folders.

## The shape of an adopted chat

Each 1.x task becomes a chat that owns that task:

```text
chats/<new chat id>/
  .instrument/task.db       the old conversation's words
  .instrument/settings.json kind "chat", the task's name, its dates, its topic
  attachments/              files the user sent in it, copied
  tasks/<task id>/          the 1.x task, moved in untouched but for parentTaskId
```

**What the chat holds, in order:** every user message, then every assistant text part with words, each in the message it came from. That's all a 2.0 chat shows anyway: tool calls, reasoning, and running tasks never draw in the chat view (`chat-stream-render-part.tsx:123`).

- **Copied:** the user's words and their attachments, and the agent's words, including any `files` fences.
- **Not copied:** tool parts, reasoning, `session-context` messages, and 1.x data parts. They stay in the task, where the chat's tasks view reaches them the way it reaches any task.
- **One data part on the first user message, `data-adoptedTask`, visible only in developer mode.** It carries the task id and the file list below. Its model text tells the chat's agent that this conversation came from an earlier version of the app, that the work was done by task `<id>` (at `/tasks/<id>`), and that `task send` continues it, with its full history.

**Its row and screen:**

- The title is the task's `name`.
- `createdAt` and `updatedAt` come from the task's settings, so the inbox orders it by when it was last active.
- The preview is the last answer's first line, as for any chat.
- The chat opens as bubbles, and a 1.x answer can be long. That's accepted.

On the real workspace, a median adopted chat is 3 bubbles and a p90 one is 12. The agent's words come to a median of 392 characters per task and a p90 of 6,963.

**Continuing it:**

1. You type in the chat.
2. The chat's agent has the old words and the adoption note in its history, so it answers or runs `task send`.
3. The task resumes with its whole transcript. The next turn swaps its stored system prompt for today's, because the prompt snapshot is older than `SESSION_CONTEXT_VERSION` (`prepare-model-messages.ts`), and it runs the assistant-facing branch of `main.ts` because `parentTaskId` is now set.

Tools the task used that no longer exist (`grep`, `glob`, `agent`, `copy_to_task`) replay as `unavailable`.

## Files and sites on the row

Best effort, from what 1.x recorded. None of it is required for the chat to work.

- **Files.**
  - Fences copied with the answers count with no extra work, since `filesHeld` reads fences in the chat's replies (78 tasks).
  - The adoption part also lists files from 1.x `data-fileChanges` parts: the `output/` entries not marked deleted, with skill copies under `work/skills/` left out (91 tasks).
  - `filesHeld` reads that list too.
  - Paths translate to `/tasks/<id>/…` (`translateTaskFolderPaths`), and a file no longer on disk is dropped.
  - Together that's 179 of 294 tasks.
- **Sites.**
  - The task's `browser-state` `lastUrl` host (49 tasks) and the hosts of `agent-browser open <url>` commands in its bash calls (62) are written once into its browser state's `visitedHosts`.
  - `sitesHeld` already reads that for every task a chat owns.
  - Together that's 91 of 294 tasks. It's a floor, because 1.x didn't record visits.
- **Apps.** None: 1.x had no connected apps.

## Projects become topics

- **Name and mark.** A leading emoji in the project's folder name becomes the topic's emoji and comes off the name. Any other project gets no emoji: `TopicFace` already draws the first letter (`topic-mark.tsx`), and `topicColor` already derives a color from the name.
- **Merge by name.** A project whose name matches an existing topic (ignoring case and the leading emoji) merges into that topic, and the topic keeps its emoji and color.
- **Instructions.** A non-empty `AGENTS.md` becomes the body of the topic's `topic.md` (for a merged topic, it's added after any body the topic already has). It reaches the chat's agent and its tasks as [chat-folders.md](chat-folders.md) describes: automatically, cut at the cap with a pointer to the file.
- **Project folders are not migrated.** A topic's own folder holds its `topic.md` and, later, reference files; it is never a folder of the user's that tasks work in. A project's folder list is dropped, and so is the `/project` mount. An adopted task that used one resumes without it. The chat's agent can hand the folder back with `task folder <id> --add`, and it can ask you for one it can't reach with `request_folder`.
- **Membership.** Every task with `projectId` gives its adopted chat that topic. `projectId` is then cleared.
- **`projects/`** moves to `.pre-chats/projects/`.

## Migration

This is the layout version after [chat-folders.md](chat-folders.md)'s, in `migrate-workspace-layout.ts`. It's raw files and `node:sqlite`, and idempotent step by step.

1. Projects to topics, as above, so the topics exist before the chats that carry them.
2. Tasks with no user message go to the trash.
3. For each remaining top-level task that isn't a chat (`kind` unset or `"task"`, no `parentTaskId`):
   1. Create the chat folder and record.
   2. Copy the words and the attachment files.
   3. Write the adoption part.
   4. Backfill `visitedHosts`.
   5. Move the task folder into `tasks/`.
   6. Set `parentTaskId`.

   This also covers any parentless task a 2.0 build made, such as the tutorial task.
4. Tasks with more than one session (7 on the real workspace) copy every session's words in order, into the one chat session.
5. Write the marker.

## Checks

- Unit tests on a fixture holding a single-ask task, a multi-ask task with attachments, a multi-session task, a task in a project with instructions, a project whose name starts with an emoji, a project that matches an existing topic, and an empty task.
- An eval (`pnpm eval run`) on an adopted fixture chat, with a follow-up that needs the old task's files. It checks that the agent uses `task send` rather than starting over, and that its reply length isn't pulled toward the long 1.x answers in its history. Run it on GLM and one GPT model.
- Boot Studio on the migrated fixture: adopted chats sit in the inbox by last activity with their topics, open as bubbles, and continue.
