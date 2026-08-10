# The task list ordered itself by a file mtime, so reading a task counted as changing it

**Status:** fixed going forward 2026-08-10; existing tasks still fall back until something happens in them. See [What is left](#what-is-left).

`updatedAt` on a task was the mtime of `.instrument/task.db`, read by `getTaskDirTimestamps` and sorted on by `getTasks`. That is not when the task was last worked on. It is when the file was last written, and **opening a task writes it**: the session store is a SQLite database, and opening it checkpoints. Measured directly, with no message sent and nothing typed:

```
before opening   16:59:06  .instrument/task.db
after opening    17:09:18  .instrument/task.db
```

So merely viewing a task made it the most recently updated task in the workspace.

## Why it stayed hidden

The sidebar reads `task.live.list`, which re-runs `getTasks` only when something publishes `task.updated`. A task climbing to the top was therefore invisible until the next publish from any cause, at which point it jumped without anyone having done anything to it. Nothing published often enough for the pattern to be obvious, and the jump never coincided with the act that caused it.

Adding a second per-task writer made it visible: the pane in [pane-tabs-and-the-show-command.md](../plans/completed/pane-tabs-and-the-show-command.md) writes `state.json` on every tab change, and its publish was the refetch that surfaced every pending mtime bump. That read as "opening the panel reorders my sidebar", which is why the pane looked like the culprit. It was the messenger.

Worth being explicit that the obvious diagnosis was wrong: writing `state.json` does **not** move the task. A rewrite of an existing file leaves the parent directory's mtime alone, and `task.db` is a different file. Verified before changing anything:

```
before   17:03:54  .instrument   17:03:54  task.db   17:03:54  state.json
after    17:03:54  .instrument   17:03:54  task.db   17:03:56  state.json
```

## The fix

Two independent changes, either of which would have hidden the symptom and only both of which address it.

- **`lastActivityAt` in `settings.json`**, written when a message is created and when a task is initialized, and preferred over the filesystem answer in `readTask`. Activity is now recorded rather than observed. `settings.json` was already read once per task by the list, so it costs no extra syscall, and it is the file that already holds the other per-task facts the list needs (pin, unread, name).
- **`task.stateUpdated`**, a publisher channel separate from `task.updated`. Pane and draft writes use it, so the surface that reads task state wakes and the task list does not. A panel opening is not activity in a task, and it should not be able to reorder anything.

The private directory also stopped being the timestamp fallback for a task with no database: it holds the pane and the draft, and adding a file to a directory does bump its mtime, so a task with no conversation would have climbed the list on its first pane write. The task's own directory is the fallback instead.

## What is left

Tasks created before this keep the filesystem fallback until their next message, so an old task opened today can still jump once. New tasks are stamped at creation and are correct from the start.

Closing that gap means backfilling `lastActivityAt` for every existing task, which is a one-time pass over the workspace at startup rather than something the list should do while reading. It is deliberately not done here: the fallback is what shipped for months, so leaving it in place is not a regression, and a migration that stamps hundreds of tasks deserves its own change.

## The general shape

A filesystem timestamp answers "when were these bytes last written", and almost every question a product asks is a different question. The two diverge silently, in the direction of "more recent than the truth", and the divergence only becomes visible when something else forces a re-read. Where the answer matters, record it.
