---
name: session-transcript
description: Export a task's session as a markdown transcript from a project directory or an exported task .zip. Use when asked to dump, export, or read a session/task as markdown, review an agent run offline, or inspect the transcript inside a shared task zip.
---

# Session Transcript

`script:dump-session-transcript` renders a task's `sessions.db` into a markdown
transcript. It accepts either a project directory or an exported task `.zip`
(the same artifact Studio's export/import flow produces), so you can read a
session a teammate shared without importing it first.

Run from `packages/workspace`:

```bash
# From a project directory (the folder containing .instrument/sessions.db)
pnpm run script:dump-session-transcript /path/to/projects/my-task

# From an exported task zip (extracted to a temp dir, then cleaned up)
pnpm run script:dump-session-transcript ~/Downloads/my-task.zip

# Write to a file instead of stdout
pnpm run script:dump-session-transcript my-task.zip --output transcript.md

# Include the model context messages (system/context), normally omitted
pnpm run script:dump-session-transcript my-task --include-context
```

## What it does

- Picks the root session (warns and uses the first if a task has more than one).
- Renders it via `getSessionMarkdown` (`src/lib/session-to-markdown.ts`), which
  inlines child sessions spawned by the `task` tool.
- Emits YAML front matter: task name, session id/title, and source path.

## Notes

- Zip handling is shared with the RPC import flow via
  `src/lib/extract-project-zip.ts`; a zip must contain a project manifest.
- Reads only; never mutates the project. Output is stdout unless `--output` is set.
- To explore raw session JSON interactively instead, use
  `script:dump-sessions` (prompts for a task, copies JSON to the clipboard).
