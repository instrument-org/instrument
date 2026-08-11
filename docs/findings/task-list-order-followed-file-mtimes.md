# The task list ordered itself by a file mtime, so reading a task counted as changing it

**Status:** fixed 2026-08-11. Both timestamps are recorded in `settings.json`; older tasks are stamped by the boot migration.

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

Three independent changes, any one of which would have hidden the symptom and only all of which address it.

- **`lastActivityAt` in `settings.json`**, written when a message is created and when a task is initialized. Activity is now recorded rather than observed. `settings.json` was already read once per task by the list, so it costs no extra syscall, and it is the file that already holds the other per-task facts the list needs (pin, unread, name).
- **`createdAt` beside it**, written at creation, at branch, and at import. The observable answer was the database's birth time, which is when the task was first *opened*, and for a branch or an import it is when the copy happened. With both stamps recorded, `readTask` reads one file and the ordering path never asks the filesystem what time it is.
- **`task.stateUpdated`**, a publisher channel separate from `task.updated`. Pane and draft writes use it, so the surface that reads task state wakes and the task list does not. A panel opening is not activity in a task, and it should not be able to reorder anything.

`getTaskDirTimestamps` survives as the answer for a task that arrives with neither stamp: one restored by hand, or one whose settings cannot be parsed. It stats the task folder and nothing inside it, so it cannot be moved by a database checkpoint or by a pane write into the private directory.

## Migrating without moving anyone's list

Existing tasks are stamped by `migrateWorkspaceLayout`, which already walks every task folder at boot and is idempotent, so an unstamped task that appears later is picked up by the next run. Measured against a 596-task workspace, reading and parsing every `settings.json` costs 26ms warm, against the ~73ms that pass already spends on its `existsSync` probes.

The seed values are the ones the old code produced: the session database's mtime and birth time, falling back to the task folder. That makes the migration a snapshot of the order a workspace already has rather than a re-sort, so nothing rearranges itself on the upgrade. It inherits the flaw it replaces, since a task merely *opened* last week is stamped last week, but that is what its owner already sees, and the drift stops there.

Stamping the current time instead would flatten every task in the workspace to one value and scramble the list. That is the failure mode this migration exists to avoid, which is why it is written down here and in the code.

## What else it fixed

Two reorderings that were never intentional went with it, because both are settings writes and neither touches the recorded stamp:

- **Marking a task read or unread** no longer moves it. It publishes `task.updated`, so the list re-reads, but the sort key does not change.
- **Renaming a task** no longer moves it either. It arguably never did on its own -- but you have to open a task to rename it, and opening it is what bumped the timestamp, so the re-read that followed the rename carried it to the top.

## Why `settings.json` and `state.json` became one file

They were two files for a reason that did not survive being asked about, and the answer is worth recording so nobody splits them again.

The reason usually guessed is export, and it is wrong: `exportTaskZip` takes the whole task folder apart from `.git`, `node_modules` and the browser profile, so `state.json` always shipped. `projectFolderName` is stored as a folder name rather than an absolute path precisely *because* the file travels. Nothing machine-local was being held back.

The reason actually given was that the split made the publisher channel structural: `updateTaskSettings` publishes `task.updated` and wakes the whole list, `setTaskState` publishes `task.stateUpdated` and wakes only the open task, so the file you wrote was the classification. That is a convenience, not a constraint. Two functions over one file classify exactly as well as two files do, which is what they now are.

Size was never the argument. Across a 596-task workspace `settings.json` ran a median of 82 bytes and `state.json` 112, so merging changed no read counts anywhere.

What is real is a difference in *lifetime*, and it is preserved as a nested key rather than a second file:

- The top level is what the app asks **about** a task: title, pin, unread, project, timestamps. The list reads it for every task in the workspace, and the cross-task index in [conversation-storage.md](../plans/active/conversation-storage.md) projects exactly these and is specified as rebuildable from them. They need a durable per-task home on disk permanently.
- `state` is where the user left off **inside** one task: draft, open tabs, chosen model, attached folders. Read when a task is open, never queried across tasks, and nothing will ever index it.

Two conditions came with the merge, because without them it would have been a downgrade:

- **The halves are parsed separately.** A draft or a pane the schema rejects must not cost the task its title and its place in the list, and a title that cannot be read must not silently unmount the folders the agent may reach. `readTaskRecord` parses each half from the same object and answers with an empty one for whichever failed.
- **Writes go through a temporary file and a rename.** One file now carries the title, the sort key and a draft rewritten as the user types. Writing over the live file leaves a window where a crash truncates it, and a truncated record does not read as damaged -- the parse fails and the task simply answers as though it has no settings.

A write also carries forward any field it could not read, at both levels, so a record written by a newer build survives an older one touching it. The nested half is the one that needed saying: the schemas strip unknown keys, so writing the parsed view back would delete them, and `state` is the half that keeps growing while the top level is a closed set.

What makes the publisher asymmetry safe is worth stating too, since it is the reason the original split looked necessary. `updateTaskSettings` publishes `task.updated` itself; the state writers leave `task.stateUpdated` to their callers. That means no state write can wake the task list, so the bug at the top of this finding cannot come back through a draft or a tab. The opposite mistake costs a panel that does not refresh.

## The general shape

A filesystem timestamp answers "when were these bytes last written", and almost every question a product asks is a different question. The two diverge silently, in the direction of "more recent than the truth", and the divergence only becomes visible when something else forces a re-read. Where the answer matters, record it.
