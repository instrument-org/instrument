# Storage for a conversation that runs for months

Status: proposed, not started. Owner: TBD. The on-ramp to option D in [conversation-storage.md](conversation-storage.md): the moves that are safe to make now, that the two-level agent needs before anything else, and that make every later phase of that plan cheaper. It replaces that plan's phase 1 with a prototype that carries none of the risks its own risk list names, and it does not depend on that plan's phase 0.

## Problem

The product is moving to one long-lived parent conversation that delegates to tasks. The parent reads task transcripts, some of them still running, and it does so for months rather than hours. Three properties of today's storage break under that shape, and none of them is visible in a corpus of short tasks.

1. **History behind a rollover is unreachable.** [apply-context-rollover.ts](../../../packages/workspace/src/lib/apply-context-rollover.ts) keeps the user's messages and drops every assistant turn, tool call, and tool result. Every dropped message stays in `task.db`, but the agent has no path to that store, so the only bridge across the boundary is the handoff notes it wrote about itself. A parent that runs for months crosses that boundary constantly.
2. **Image reads dominate storage and nothing reclaims space.** Half of every byte stored is `read_file` output, almost all of it base64 image data, in a database opened with `auto_vacuum` off. A task that dies young never notices. A parent conversation accumulates the same tail with no end.
3. **The database is configured for one reader-writer.** No pragma is set anywhere in [session-store-storage.ts](../../../packages/workspace/src/lib/session-store-storage.ts), so the journal mode is the default rollback journal. A reader blocks the writer and the writer blocks readers. The parent inspecting a running task is exactly one reader against one live writer.

## What the databases hold

Measured 2026-09-04 over every task database in one production workspace: 302 databases, 198 MB on disk, 13,556 message parts.

| Part type      | Parts | Bytes   | Share |
| -------------- | ----: | ------: | ----: |
| `read_file`    |   631 | 79.1 MB | 50.3% |
| `bash`         | 2,003 | 28.2 MB | 17.9% |
| reasoning      | 2,147 | 17.3 MB | 11.0% |
| `fileChanges`  |   236 |  7.8 MB |  5.0% |
| text           | 2,340 |  7.3 MB |  4.6% |
| everything else | 6,199 | 17.3 MB | 11.2% |

Within `read_file` the distribution is a heavy tail: median 9.6 KB, p75 93 KB, p90 271 KB, p99 1.8 MB, largest 4.5 MB. The 92 parts over 200 KB hold 80% of `read_file` bytes, which is **41% of every byte in every database, in 0.7% of the parts.** Each of those is one image read, stored inline by [read-file.ts](../../../packages/workspace/src/tools/read-file.ts) as `base64Data`.

The whole schema is one table with a primary key and no other index:

```sql
CREATE TABLE sessions (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  blob       BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

Read off a live database: `journal_mode` is `delete`, `auto_vacuum` is `0`, `user_version` is `0`. A `__migration_version__` row does the versioning job one layer up, which is worth noticing: the store already runs migrations, as runtime code rather than DDL.

## What an agent does with its own record

The choice between a structured record and a readable one was left open at the end of [conversation-storage.md](conversation-storage.md). It can be settled on behavior rather than taste. Measured 2026-09-04 over the session logs of a coding agent on a developer machine: 723 sessions, 56,805 shell commands.

- 913 commands read or searched a transcript, across **157 sessions, 22% of all of them**. Reaching back into the record is routine, not recovery.
- What runs first: Python 36%, plain unix 30% (almost entirely `ls` and `head` locating the file), ripgrep 22%, node 6%, jq 5%. Counting only commands that extract something, a parser beats a grep about two to one.
- Of the 463 commands that parse, the fields they select on: `type` 26%, `content` 25%, `message` 23%, `user` 19%, `tool_use` 18%, `name` 16%, `input` 12%, `timestamp` 11%. Those are structural selections, every user message, every tool call of one name, its input, in order, and a readable rendering cannot answer any of them without the agent inventing a parser for a format that exists nowhere else.

So the record is JSONL. The markdown rendering keeps its job: [session-to-markdown.ts](../../../packages/workspace/src/lib/session-to-markdown.ts) is for a person reading a session back, and it needs no change. Two projections of one store, for two readers.

This is behavior given a JSONL file. It cannot show what an agent would do with a markdown one, and phase 1 ends with the eval that can.

## The shape

Four layers, each with one job, and exactly one of them authoritative.

1. **The record.** One JSONL file per session, holding the regions that have fallen out of the context window, appended once per rollover. Source of truth for what happened. Readable by the agent with the tools the measurement above shows it already uses, and the thing every layer below rebuilds from.
2. **The live store.** Per-task SQLite, as today, opened in WAL mode with incremental vacuum. One writer per file, so parallel tasks never contend, and the private directory stays the isolation boundary between agents.
3. **The blob store.** Content-addressed files beside the database, referenced from the part by hash, media type, and size. Takes the 41% out of the conversation store and takes the growth curve off a months-long parent.
4. **The index.** One small SQLite owned by the parent, one row per task, metadata only. Derived, rebuildable from layer 1, carrying a schema generation so a format change triggers a rebuild rather than serving wrong rows. The only layer that knows about every task.

**The record is authoritative, not the store.** This is the decision underneath the other three. It is what makes a corrupt or half-written database recoverable rather than merely backed up, and it is what makes later migrations of layers 2 and 4 safe: the worst outcome of a bad migration becomes delete and rebuild, not lost history. The prior art in [conversation-storage.md](conversation-storage.md) runs dozens of numbered migrations on its index for exactly this reason. Its index is disposable.

### Why per-task stores rather than one

One central database was considered and is option B in the parent plan. Under parallel tasks it costs the wrong thing. WAL gives one writer and many readers, but concurrent writers still serialize, so parallel tasks all streaming parts would contend on one file. It also turns task deletion from a directory removal into cascade rules, and it re-implements in software the per-agent isolation that the private directory gives for free. The one thing it buys, cross-task search as a single query, is what layer 4 provides without merging the stores.

Fanning out is not slow yet. Scanning all 302 databases for a string takes 2.4 seconds on the measured workspace. That is linear, and the parent's responsiveness budget breaks it at roughly ten times the task count. That is the point at which the index earns its place, and it is an index over metadata, never a merge.

### Why this replaces the parent plan's phase 1

That plan prototypes the live write path and lists its risks. Every one of them is a risk of writing data that is still changing. The region behind a rollover boundary is closed and will never change again, so writing it once is archiving, not mirroring.

| Risk named in the parent plan                    | Under a frozen-region archive                                         |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Write amplification during streaming             | No streaming write exists. One append per rollover.                   |
| A reader tolerating a torn trailing line         | Nothing is appended mid-turn.                                         |
| Concurrent writers across instances              | One session, one boundary, one writer.                                |
| Atomicity that SQLite gave for free              | SQLite still has it. The store is still where the live turn lives.    |
| Unbounded growth needing a compression worker    | Bounded by rollovers, not by turns. Deleted with the task.            |
| JSON escaping for search                         | Real: this is why phase 1 ends with an eval rather than an assumption. |

The live window is not in the file because the live window is already in context. The only rows the file ever holds are ones the model can no longer see.

## Phases

Each phase makes the next one safer rather than depending on it, and any of them can ship alone.

### 1. The frozen-region record

- A path constant beside the handoff-notes one in [handoff-notes.ts](../../../packages/workspace/src/lib/handoff-notes.ts), so the writer and the notice derive from one value. Under `work/`, next to the notes, for the same reason: the agent's own record, not a deliverable. A task with sessions beyond the root gets one file each.
- Render at the boundary. [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) is the only code that records one, right after `Store.saveSession` succeeds. Serialize the messages from the previous boundary through the newest id and append them. Non-fatal on every failure path: a rollover that could not write its record is still a rollover, and the turn proceeds.
- The line shape borrows the one the measurement shows agents can navigate: `type`, `message.content[]`, `tool_use` blocks carrying `name` and `input`, `timestamp`. Matching it buys the model's priors for free; inventing a third shape spends them.
- Three sentences in `contextRolloverNotice`, both the with-notes and the no-notes branches, since an agent that wrote no notes needs the record more: the path, that it is large enough to refill the window this reset cleared, and the access pattern (search for a distinctive string, then read a bounded slice with `read_file`'s `offset` and `limit`). Inline what the next turn needs; name the path for what a later turn might.
- Prove it with a real agent. A shrunk context window makes the boundary reachable in a three-turn conversation, which [context-compaction.md](context-compaction.md) already asks for. Then `pnpm eval run` across the model set with a question whose answer exists only behind the boundary, one arm per format. The question a unit test cannot answer is the one that killed the first rollover: whether a model with a real user message in front of it spends a tool call on a file it was merely told about.

### 2. The live store's configuration

- Open every task database in WAL mode with a busy timeout, and enable incremental vacuum, in [session-store-storage.ts](../../../packages/workspace/src/lib/session-store-storage.ts). Neither touches the shape of any data. WAL is the precondition for the parent reading a running task; incremental vacuum is what lets a months-long store give space back after compaction.
- Leave `user_version` alone. The `__migration_version__` row works and moving it is churn.
- Add an index only when a query needs one. The parent plan's prior art is explicit: store the blob, promote a field to a column when a read asks for it.

### 3. The blob store

- Content-addressed files under the task's private directory, named by content hash, written by the tools that produce binary output. [read-file.ts](../../../packages/workspace/src/tools/read-file.ts) is the writer that matters: the part stores a reference (hash, media type, byte size) in place of `base64Data`, and the model-message conversion resolves it when the image is sent.
- Beside the database rather than under `work/` or the user's folder, for the reason [conversation-storage.md](conversation-storage.md) gives for conversation-scoped assets: deleting the task deletes what only the task referenced, and it stays outside the file index.
- Threshold is the open question below. The measured tail says a size threshold catches nearly everything; a type threshold (all binary) is simpler to reason about and costs little extra.
- The record from phase 1 carries the reference, not the bytes, so the file stays greppable and the blob is shared between the store and the record.

### 4. The parent's index

- One SQLite owned by the parent, one row per task: id, timestamps, title if any, model, the sort keys a list needs, and a bounded projection of structured references such as produced files. Never the text.
- Derived and rebuildable from layer 1 from day one: a function that rebuilds it, and a test that runs the function. A schema generation column so a format change rebuilds rather than serving stale rows.
- Whether a task may inspect a sibling becomes a predicate evaluated here, against a flag on the task, rather than a question about which agent may open which database on disk.
- Cross-task search stays ripgrep over the record directory, joined to the index for ordering and pagination, until the scan measured above stops fitting the parent's responsiveness budget.

After phase 4 the remaining work is the parent plan's phases 4 through 6: the store swap behind the seam, the one-shot converter, and the agent capability on top.

## Interaction with other plans

- [conversation-storage.md](conversation-storage.md) is the long form and stays the plan of record for the migration. This plan takes its phase 1 and does it without the live write path, and it does not need its phase 0: the id split exists because one value is key, folder name, DNS label, and title, and the title job goes away when tasks stop being user-facing. That plan's option D is where this one lands.
- [context-compaction.md](context-compaction.md) gains a retrievable archive, which lowers what its summarizing phase has to achieve. A summary only has to make the agent know a thing exists, not preserve it losslessly.
- [user-chosen-working-folder.md](../completed/user-chosen-working-folder.md) is independent. The record's virtual path does not move when `work/` moves on disk, because every consumer resolves through the mount table.
- [skills-mount-instead-of-copy.md](skills-mount-instead-of-copy.md) step 3 gates the cross-task half. Today no task can see another task's directory at all; the parent reading a task's record needs a mount that does not exist, and a real binary writing there needs the native bridge to take the layout. Phase 1 here is single-task and needs neither.

## Open questions

- **Blob threshold.** All binary parts, or only parts over a size. The tail is concentrated enough that a 200 KB threshold catches 80% of `read_file` bytes in 92 parts, but a type rule is easier to explain and to test.
- **Whether the record is ever user-facing.** Filing it under `work/` decides no by placement. The 2.0 wireframes show search returning past work, which is the same data behind a different surface. Worth deciding on purpose: the user asks the agent, the agent reads the file, one copy, hidden.
- **Sibling inspection default.** A flag on the task, evaluated at the index. Whether it defaults open or closed is a product call this plan does not make.
- **The format eval before the writer.** The measurement shows behavior given JSONL and cannot show behavior given markdown. One eval with both arms, before phase 1's writer is committed, is cheap and is the only way to know the format choice is right rather than plausible.
