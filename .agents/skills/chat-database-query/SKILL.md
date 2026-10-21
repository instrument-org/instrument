---
name: chat-database-query
description: Read a chat database with safe read-only SQL, and read a chat's records where there is no database. Use when an Instrument chat or task investigation needs raw messages, parts, sessions, or any other stored records.
---

# Chat Database Query

A chat keeps its conversation in records now: one append-only JSONL file per session per device in its record folder. There is a database to query only where one still exists, which is a chat the converter has not reached, the copy it set aside when it did (`set-aside/chat-db/<chat>.db` in the workspace's machine folder), or a task store a 1.x install left. For a chat on this build, read the records (below) or render a transcript with the `session-transcript` skill.

## A chat's records

Each file is `<session>.<device>.jsonl`, one line per record, and the first line is the session's header (`t: "session"`, with `parent` and `handle` on a task's). After it come `message`, `part`, `state`, `retract`, `rollover` and `stopped` records, and a chat's settings (title, starred, archived, unread, topic, model) are `set` records in `settings.<device>.jsonl` beside them (`marks.<device>.jsonl` with `mark` records in older chats). So `jq` answers most questions without any tool of ours:

```bash
# The sessions in a chat: the chat's own has no parent, each task names it.
head -qn 1 <workspace>/.instrument/chats/<chat-id>/*.jsonl \
  | jq -c 'select(.t == "session") | {id, parent, handle, createdAt}'

# What the model and the person said, in order, from one session's log.
jq -c 'select(.t == "message") | {at, role: .message.role}' \
  <workspace>/.instrument/chats/<chat-id>/<session>.<device>.jsonl
```

A line is the record as it was written, so nothing has to be decoded first, and reading one never changes a chat.

## Where a database is still there

Run the generic query tool, which lives in `packages/workspace`. The filter is what lets the command run from anywhere in the monorepo rather than only from that package:

```bash
pnpm --filter @instrument-org/workspace run script:query-chat-db <workspace>/.instrument/chats/<chat-id> \
  --sql "select key, created_at, updated_at from sessions order by updated_at desc limit 20" \
  --format table
```

The first argument can be a chat's folder or the database itself. A chat's record folder (`.instrument/chats/<id>/` in the workspace) resolves to its `chat.db`; a set-aside copy is named by its path. A chat's tasks have no database of their own: each is a session in its chat's store, so query the chat's.

The tool accepts one read-only `SELECT`, `WITH`, `EXPLAIN`, or `PRAGMA` statement. It opens the database read-only and denies SQLite operations other than reads. Use `--file query.sql` for a multi-line query, `--format json` for machine-readable output, or `--schema` to inspect available tables and indexes.

Read-only is the whole contract, so do not reach around it with `sqlite3` to set up a state you want to see. A stored value is a serialized payload rather than the JSON it looks like, and rewriting one through `json_set` hands the store back something it cannot decode: the chat then fails to open at all, which costs the person whose chat it was. Produce the state through the app instead, or build a chat that has it.

A chat's history is a key-value store in the `sessions` table. The application uses key prefixes such as `sessions:<session>`, `messages:<session>:<message>`, and `parts:<session>:<message>:<part>`. The chat's own session has no `parentId`; each task is a session whose `parentId` is the chat's, with its `handle` (`t1`), `title`, `status` and `forkedAtMessageId` on the row, and a task's messages before that point are read from the chat's session rather than copied. Structured payloads may be in `blob` instead of `value`; cast the blob to text before applying JSON functions:

```sql
select
  key,
  json_extract (cast(blob as text), '$.json.role') as role,
  json_extract (cast(blob as text), '$.json.metadata.createdAt') as created_at
from
  sessions
where
  key glob 'messages:*'
order by
  created_at;
```

A chat's tasks:

```sql
select
  json_extract (cast(blob as text), '$.json.handle') as handle,
  json_extract (cast(blob as text), '$.json.id') as session,
  json_extract (cast(blob as text), '$.json.title') as title,
  json_extract (cast(blob as text), '$.json.status') as status
from
  sessions
where
  key glob 'sessions:*'
  and json_extract (cast(blob as text), '$.json.parentId') is not null;
```

Keep the query generic. Derive chat-specific summaries, pricing, or product judgments from the raw result in the calling session rather than encoding them in this tool.
