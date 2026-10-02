---
name: session-transcript
description: Export a task's session as a markdown transcript from a task directory, or from a task .zip an older build exported. Use when asked to dump, export, or read a session/task as markdown, review an agent run offline, or inspect the transcript inside a shared task zip.
---

# Session Transcript

`script:dump-session-transcript` renders a task's or a chat's `.instrument/task.db` into a markdown transcript. It accepts either a task directory or a task `.zip` exported by an older build, which had an export flow the app no longer offers.

The script lives in `packages/workspace`; the filter runs it from anywhere in the monorepo:

```bash
# From a chat's folder, one of its tasks, or a task no chat owns
# (any folder containing .instrument/task.db)
pnpm --filter @instrument-org/workspace run script:dump-session-transcript <workspace>/chats/my-chat
pnpm --filter @instrument-org/workspace run script:dump-session-transcript <workspace>/chats/my-chat/tasks/my-task
pnpm --filter @instrument-org/workspace run script:dump-session-transcript <workspace>/tasks/my-task

# From an exported task zip (extracted to a temp dir, then cleaned up)
pnpm --filter @instrument-org/workspace run script:dump-session-transcript ~/Downloads/my-task.zip

# Write to a file instead of stdout
pnpm --filter @instrument-org/workspace run script:dump-session-transcript my-task.zip --output transcript.md
```

## What it does

- Picks the root session (warns and uses the first if a task has more than one).
- Renders the selected session via `getSessionMarkdown`
  (`src/lib/session-to-markdown.ts`).
- Includes the latest persisted system and agent-context snapshot. Long-running
  sessions may have refreshed this snapshot, so it may differ from context used
  by earlier responses.
- Emits YAML front matter with task/session identity, model/provider usage,
  token totals, AI-generation and elapsed durations, message/tool counts, and
  source details.
- Annotates each assistant response with its model, finish reason, token
  breakdown, latency, throughput, and full persisted error metadata.
- Preserves user-turn/model-step boundaries, provider sources, file changes,
  other persisted data, empty/aborted steps, and interrupted or invalid tool
  diagnostics.

## Notes

- Zip handling lives in `src/lib/extract-task-zip.ts`; a zip must contain task settings.
- Reads only; never mutates the task. Output is stdout unless `--output` is set.
- To explore raw session JSON interactively instead, use `script:dump-sessions` (prompts for a task, copies JSON to the clipboard).
