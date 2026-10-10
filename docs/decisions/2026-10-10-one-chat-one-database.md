# One chat, one database: a task is a child session, not a record

Date: 2026-10-10

## Context

After [one agent that forks](2026-10-07-one-agent-that-forks.md), a task started by `task new` was a record of its own: a folder under `chats/<id>/tasks/<id>/` with its own `task.db` and `settings.json`, marked `fork: true` and `workdir: <chat id>`, whose session began with a copy of the chat's conversation. Everything that acted on a task went through a record lookup (id to folder to database), a task carried its own model, effort, attached folders and tabs, and the folders it reached had to be kept in step with its chat's (`task folder --add` granted to the chat and to each running fork, and mount names were shared so paths matched on both sides).

## Options weighed

- **Keep forks as records, fold their databases into the chat's.** Removes one database per task but keeps the second record, the copied conversation, and per-task settings that had to agree with the chat's.
- **A chat as the only record, its database holding sessions as a tree.** A task is a session whose parent is the chat's, with the parent's last inherited message on the row; its history is read from the parent rather than copied. Model, effort, folders and tabs live once, on the chat.

## Choice

A chat is the only record: `chats/<id>/` with `.instrument/settings.json` and `.instrument/chat.db`. The database holds sessions and their messages. The chat's conversation is the session with no parent; a task is a child session with `parentId` and `forkedAtMessageId`, addressed in the agent's `task` command by a per-chat handle (`t1`). `TaskId` is gone; a chat is a `ChatId` and a task a `SessionId`. The chat's settings carry the model and reasoning effort every session runs on and the folders granted in the chat; its state carries the tabs its sessions drive, each naming its driver.

## Why

- A fork's first request reads nearly all of the chat's prefix from the prompt cache, and reading the prefix from the parent sends the same bytes without storing them twice or letting a copy drift.
- One record removes the lookups and the agreement problems: a task cannot run on a different model, reach different folders, or name a folder by a different path than its chat, because it has nothing of its own to disagree with.
- "Task" stays a word in the agent's command and the UI, not in storage, so a later shape (a task with its own model, a fork of a fork, an edited message as a branch) is a new kind of session row rather than a schema change.

Carried out in `b834385c7` through `de7293135`; the plan, with what was built differently, is [one chat, one database](../plans/completed/one-chat-one-database.md).
