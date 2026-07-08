---
name: studio-dev-logs
description: Read Studio main-process logs written during local development. Use when you want to inspect what happened during a Studio session — errors, warnings, or info messages from the Electron main process.
---

# Studio Dev Logs

When Studio runs in development (`NODE_ENV=development`), the Electron main process
writes every `console.debug/info/warn/error` call to a newline-delimited JSON file
under `apps/studio/.logs/`.

## File layout

```plaintext
apps/studio/.logs/
  2026-06-01T20-03-00Z.jsonl   ← one file per boot, named by start time
  2026-06-01T21-14-55Z.jsonl
  current.jsonl -> 2026-06-01T21-14-55Z.jsonl   ← symlink to the most recent boot (macOS/Linux only)
```

## Reading logs

On macOS/Linux, read `current.jsonl` for the most recent session:

```bash
cat apps/studio/.logs/current.jsonl
```

On Windows there is no symlink — pick the newest timestamped file instead:

```bash
ls -t apps/studio/.logs/*.jsonl | head -1
```

Each line is a JSON object:

```jsonl
{"level":"info","time":"2026-06-01T21:14:55.123Z","msg":"App already running, quitting"}
{"level":"error","time":"2026-06-01T21:15:02.456Z","msg":{"name":"Error","message":"connect ECONNREFUSED","stack":"Error: connect..."}}
```

Fields:

- `level` — `debug` | `info` | `warn` | `error`
- `time` — ISO 8601 timestamp
- `source` — present only on entries forwarded from the **renderer** process (value `"renderer"`). Absent on main-process entries.
- `msg` — string for plain messages; object for `Error` instances (`name`, `message`, `stack`, optional `cause`); array when multiple arguments were passed

Most entries are from the Electron **main** process. Renderer errors (uncaught
exceptions, unhandled promise rejections, and explicit `logger.error` calls) are
forwarded over IPC and tagged `"source":"renderer"`; other renderer `console.*`
output still only lands in the DevTools console, not this file.

Filter to errors only:

```bash
grep '"level":"error"' apps/studio/.logs/current.jsonl | jq .
```

Filter to renderer-forwarded entries:

```bash
grep '"source":"renderer"' apps/studio/.logs/current.jsonl | jq .
```

Tail the live log while Studio is running:

```bash
tail -f apps/studio/.logs/current.jsonl | jq .
```

## Notes

- Logs are only written when `NODE_ENV=development`. No log files are created in production builds.
- The `.logs/` directory is gitignored.
- Old boot files accumulate; delete them manually if they grow large.
