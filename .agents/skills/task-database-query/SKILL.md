---
name: task-database-query
description: Read a chat's .instrument/chat.db with safe read-only SQL. Use when an Instrument chat or task investigation needs raw messages, parts, sessions, or any other stored records.
---

# Task Database Query

Run the generic query tool, which lives in `packages/workspace`. The filter is what lets the command run from anywhere in the monorepo rather than only from that package:

```bash
pnpm --filter @instrument-org/workspace run script:query-task-db <workspace>/chats/<chat-id> \
  --sql "select key, created_at, updated_at from sessions order by updated_at desc limit 20" \
  --format table
```

The first argument can be a chat's folder or the database itself. A chat's folder resolves to `.instrument/chat.db`. A chat's tasks have no folder or database of their own: each is a session in its chat's store, so query the chat's.

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
