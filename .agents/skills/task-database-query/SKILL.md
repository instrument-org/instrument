---
name: task-database-query
description: Read task .instrument/task.db files with safe read-only SQL. Use when an Instrument task investigation needs raw messages, parts, sessions, or any other stored records.
---

# Task Database Query

Run the generic query tool from `packages/workspace`:

```bash
pnpm run script:query-task-db /path/to/task \
  --sql "select key, created_at, updated_at from sessions order by updated_at desc limit 20" \
  --format table
```

The first argument can be a task directory or the database itself. A task
directory resolves to `.instrument/task.db`.

The tool accepts one read-only `SELECT`, `WITH`, `EXPLAIN`, or `PRAGMA`
statement. It opens the database read-only and denies SQLite operations other
than reads. Use `--file query.sql` for a multi-line query, `--format json` for
machine-readable output, or `--schema` to inspect available tables and indexes.

Task history is a key-value store in the `sessions` table. The application uses
key prefixes such as `sessions:`, `messages:`, and `parts:`. Structured payloads
may be in `blob` instead of `value`; cast the blob to text before applying JSON
functions:

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

Keep the query generic. Derive task-specific summaries, pricing, or product
judgments from the raw result in the calling task rather than encoding them in
this tool.
