# Plan: conversation storage the agent can read across

Status: proposal, not started. Owner: TBD. Split out from [user-chosen-working-folder.md](user-chosen-working-folder.md) because it is a separate axis: that plan decides where the user's _files_ live, this one decides where the app's _conversation data_ lives. Neither blocks the other.

## Problem

Each task's conversation lives in its own SQLite file at `tasks/<id>/.instrument/task.db`. That makes any cross-task question expensive and any agent-driven one impractical: "when did we discuss X", "find the task where I set up the deploy script", "rename this project everywhere" all require opening every database in turn.

This is about to matter more than it does today. The near-term goal is for the agent to have meta control over the app: search its own history, discover old conversations, reorganize projects. With per-task databases, every one of those capabilities needs a bespoke fan-out tool.

Two repo skills are the current cost, already paid: `task-database-query` exists to run safe read-only SQL against a task database, and `session-transcript` exists to convert one into readable markdown. Both are workarounds for our own data being unreadable by the tools we ship.

## The finding that changes the estimate

**There is no relational schema to migrate.** The task database is a key-value store, not a modeled one:

- [session-store-storage.ts](../../../packages/workspace/src/lib/session-store-storage.ts) builds an [unstorage](https://unstorage.unjs.io) instance over a `db0` connector over `node:sqlite`, writing to a single table named `sessions`.
- [store.ts](../../../packages/workspace/src/lib/store.ts) accesses it purely through hierarchical string keys and prefix scans: `storage.getKeys(StorageKey.MESSAGES_KEY)`, `getItemRaw`, `setItemRaw`. Keys are built in [storage-key.ts](../../../packages/workspace/src/lib/storage-key.ts) by joining segments (`messages:<sessionId>:<messageId>`, `sessions:<sessionId>`, and so on).
- Values are Zod-validated on the way in and out ([set-parsed-storage-item.ts](../../../packages/workspace/src/lib/set-parsed-storage-item.ts), [get-parsed-storage-item.ts](../../../packages/workspace/src/lib/get-parsed-storage-item.ts)), so the schema lives in TypeScript, not in the database.
- Everything funnels through one function, `getSessionsStoreStorage(taskId)`, with a per-task cache and disposal bookkeeping.

So SQLite here is an implementation detail of a KV store whose interface is prefix scans over string keys, behind a single chokepoint. Changing the backing store is a driver swap plus key namespacing, not a schema rewrite.

## Prior art

Four agent products were examined in depth. They disagree about where conversation bodies live and agree completely about everything else.

### Reference A: a Rust CLI agent

**Append-only JSONL files are the source of truth; SQLite is a rebuildable projection.**

- Each thread is a JSONL rollout file. The SQLite side stores `thread_turns` and `thread_items` rows carrying `item_json` plus a `rollout_ordinal`, a `rollout_byte_offset`, and an end offset per turn. The offsets mean the reader **seeks into the file** rather than replaying it, which is the answer to the obvious "folding a long log gets expensive" objection.
- A backfill subsystem rebuilds the projection from the rollout files, so the database is disposable by construction rather than by policy.
- **Full-text search over history shells out to ripgrep.** There is no FTS table. It greps the rollout directory, then joins the matching files against the SQLite index for ordering, filtering, and pagination. An in-process scan is the fallback when ripgrep is unavailable, so the binary is an optimization and not a hard dependency.
- Two non-obvious costs they had to pay: the search term is **JSON-escaped before grepping**, because the file contains JSON-encoded strings rather than raw text; and a background worker **compresses old rollouts**, with search made compression-aware through a logical-path indirection. Append-only logs grow, and somebody eventually pays for that.
- Cross-process writes are serialized with lockfiles in a dedicated lock directory.
- The projection schema shows the pattern for evolving JSON-in-a-column: an `item_type` column was added later and backfilled with `json_extract(item_json, '$.type')`, then indexed with a partial index for user messages. Store the blob, promote fields to columns when a query needs them.

### Reference B: a TypeScript agent monorepo

**Event sourcing inside SQLite.** Append-only `session_entries` (`entry_seq` monotonic per session, `parent_id` on each entry), a `session_sequences` counter table, and `branch_entries` mapping branches to entries. Conversation branching is a first-class part of the data model, not a feature bolted on later.

The fold problem is solved with explicit rollup tables: `session_materialized` (one row per session: name, message count, token counts, cost total, current model) and `entry_materialized` (derived per-entry data keyed by session, sequence, and type). They never recompute a session summary by scanning entries.

**They ship both backings behind one interface, and that is the most useful thing here.** A single `SessionRepository` contract (`create` / `open` / `list` / `delete`) has two implementations: the SQLite one above, and a JSONL one writing one append-only file per session. Neither is a legacy path being retired; both are current. This is direct evidence for the seam in phase 2 below — the D-versus-C question does not have to be answered before the interface exists, and answering it wrong is not fatal.

Their SQLite path also demonstrates the search strategy Reference A rejected: an FTS5 virtual table over `session_entries.payload`, maintained by insert/delete/update triggers, queried with `bm25()` ranking and filtered by the session's `cwd` column. So the prior art now covers both content-search designs rather than only the ripgrep one.

### Reference D: a Rust TUI agent

**A directory per session, under a directory derived from the working directory.** The path is `<home>/sessions/<encoded-cwd>/<sessionId>/`, and the session directory holds the transcript (`updates.jsonl`) alongside `images/` and `mermaid/` subdirectories for media the transcript references.

Two details are worth more than the shape:

- **Conversation-scoped assets are stored with the conversation**, not in the working directory and not in a scratch area. A generated image belongs to the exchange that produced it and travels with it. We currently have no home for this category at all; see [Conversation-scoped assets](#conversation-scoped-assets).
- **Encoding a path into a directory name is lossy, and they pay for it explicitly.** Short paths are URL-encoded and reversible. Long ones fall back to `<slug>-<hash16>`, which is not, so a `.cwd` sidecar file is written into the directory to recover the original — created with `O_CREAT|O_EXCL` against races from parallel session starts. Decoding distinguishes the two forms by whether the URL-decoded name looks like an absolute path. That is three mechanisms to answer "which folder was this?", which is the honest cost of making the folder part of the path.

### Reference C: a TypeScript coding agent

**Fully relational SQLite via Drizzle**, with `session`, `message`, and `part` tables. Payloads that are only ever read whole live in JSON-mode columns (`metadata`, `revert`, `permission`, `model`, `summary_diffs`); anything queried, sorted, or aggregated is a flat column (`cost`, `tokens_input`, `tokens_output`, `time_archived`, `project_id`, `parent_id`, `slug`, `directory`). Deletion integrity comes from a foreign key with `onDelete: "cascade"` from session to project.

**They migrated to this from one-JSON-file-per-key storage.** The legacy layer is still in the tree: a `read`/`write`/`update`/`list`/`remove` interface over a `string[]` key joined into a path with `.json` appended. That is the same shape as unstorage's filesystem driver, and it is the design that lost.

### What this changes

The score is not "files versus databases." Two keep bodies in files, one keeps them in SQLite, and one ships both behind a common interface. But the one that abandoned files abandoned **one file per key**, which is the pathological variant: thousands of tiny files, no atomic multi-key write, directory enumeration as a hot path. The ones that kept files use **one append-only file per conversation**, which has none of those properties. That distinction is the whole ballgame, and it was previously a caveat in this document rather than a finding.

The unanimous agreement is more actionable than the disagreement:

1. **All four separate list-view data from conversation bodies.** A `threads` table, a `session_materialized` rollup, flat columns on `session`. Nobody computes a task list by reading conversations. We should treat "what the sidebar needs" as its own store no matter which option wins.
2. **All four store bodies as opaque JSON with promoted columns.** Nobody models message parts relationally. Our Zod-validated blobs are already the right shape.
3. **Three of four are explicitly append-only** with derived rollups, and the fourth supports branching through parent pointers. Given [edit-user-message-in-place.md](edit-user-message-in-place.md) is already planned, an append-only model with parent pointers gets conversation branching nearly for free, where mutable rows make it a migration.
4. **All four generate an opaque id and store the human-readable name separately.** See [Naming, identity, and where the files live](#naming-identity-and-where-the-files-live) — this is the agreement that costs us the most, because it is the one we currently violate.

## Naming, identity, and where the files live

Once a conversation is a file rather than a folder, it needs a name, and the name is a design decision rather than a formatting one. Here is what the four actually do:

| Reference | Path                                                          | Id form                    | Working directory is       |
| --------- | ------------------------------------------------------------- | -------------------------- | -------------------------- |
| A         | `sessions/<YYYY>/<MM>/<DD>/rollout-<ISO-ts>-<threadId>.jsonl` | UUID                       | A field in the header line |
| B         | `sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl`               | UUIDv7                     | A directory in the path, and a header field |
| C         | Rows in one database                                          | `ses_` + time-sortable id  | A column, plus a `project_directory` join table |
| D         | `sessions/<encoded-cwd>/<sessionId>/updates.jsonl`            | Opaque session id          | A directory in the path, with a `.cwd` sidecar when lossy |

Three things they agree on, and each one contradicts something we do today.

**The id is generated and opaque; the human-readable name is data.** Not one of them derives the filename from the prompt. Titles are stored as a field (`slug`, `name`, `title`) and are freely editable, because a title the user can rename cannot also be a primary key. Two of the four sort by embedding time in the id rather than in the name; Reference C goes further and generates a **descending** variant so that a plain lexicographic sort over ids yields newest-first, which is what you want when the id is a filename.

**Time goes in the path or the id, not in the title.** Reference A partitions by `YYYY/MM/DD` directories, which keeps any single directory small enough to enumerate and makes date-range pruning a path operation. B puts a timestamp prefix on the filename. Both get chronological ordering without reading a single file.

**The working directory is recorded either way, and only sometimes indexed.** Three of four make it part of the storage path; A keeps it purely as a header field and filters by query. The three that put it in the path all had to solve the same problem — path strings are not filenames — and their answers escalate from "URL-encode it" to "URL-encode it, and when that is too long, hash it and write a sidecar so you can still tell what it was."

### What this says about our task id

**Our task id currently does four jobs, and this plan plus the folder plan break three of them.** It is simultaneously the primary key, the on-disk folder name, the DNS label of the asset origin ([asset-origin.md](../../architecture/asset-origin.md)), and the human-readable title — `2026-06-23-add-a-dark-mode-toggle`, derived from a slug of the user's first prompt by [generate-task-folder-name.ts](../../../packages/workspace/src/lib/generate-task-folder-name.ts). None of the four references overloads one value that far, and the overload is what makes several things awkward that should be easy: a task cannot be renamed, two tasks a second apart collide into a `-2` suffix, the id leaks the user's first prompt into a hostname, and being guessable is a security property rather than a cosmetic one ([asset-origin-is-open-to-any-local-reader](../../findings/asset-origin-is-open-to-any-local-reader.md)).

**Recommendation: split it.** A generated time-sortable id (we already have the machinery — `StoreId` is `ses_` plus a ULID) as the key, the filename, and the origin label; a separate stored `title` that starts as today's slug and becomes editable. This is a prerequisite for the storage change rather than a nice-to-have, because the filename is chosen at the moment the conversation is created and cannot be revisited cheaply afterward.

Two specifics worth pinning now:

- **Prefer date-partitioned directories over one flat directory**, per Reference A. A single directory holding every conversation a user ever had is enumerated by the list view and by ripgrep, and it is the shape that gets slow quietly rather than loudly.
- **Do not put the working directory in the path.** We are the one product here with a real database and a real list view already, so we get Reference A's option for free: record the folder as a field, index it, and filter by query. That avoids all three of the escaping, length, and reversibility problems the other references pay for, and it survives the user moving or renaming their folder — which the path-encoding approach does not, since a moved folder silently becomes a second, empty history.

### Project identity, which is a separate question with a better answer

Reference C is the only one that solves "same project, different directory," and the way it does so is worth stealing outright: **a project's id is the hash of its repository's initial commit** (`git rev-list --max-parents=0`, first sorted), not its path. A `project_directory` table then maps one project to many directories, each typed `main` / `root` / `git_worktree`.

That gets several things at once: a repository moved on disk keeps its history, a second clone unifies with the first, and multiple git worktrees of one repo are one project rather than three. It also directly informs the folder plan's deliberately-restrictive decision that a project owns exactly one working folder — the reference that has run furthest with this models one-to-many, and distinguishes the kinds.

Falling back to the path when there is no repository is the obvious completion, and it is what we would do for the non-code tasks that are most of our usage.

## Conversation-scoped assets

A category we have never had to name, because the task folder absorbed it: files that belong to the **exchange** rather than to the user's work or to the agent's scratch. Generated images, browser screenshots, tool-output spill logs, document thumbnails, chart renders.

Today they live under `work/` inside the task directory, and the transcript references them by task-relative path. That works only because the task directory is simultaneously the conversation's home and the working directory. Both of this plan and [user-chosen-working-folder.md](user-chosen-working-folder.md) sever that: the conversation moves to a file in application data, and the working directory becomes a folder the user owns. Neither is the right home for a screenshot.

- Not the working folder: writing our screenshots into a user's repository is exactly the pollution that plan exists to stop.
- Not scratch: scratch is disposable by definition, and a transcript that renders an image from six months ago needs that image to still exist.
- Beside the conversation, per Reference D, is the answer that keeps deletion honest — deleting the conversation deletes what only the conversation referenced.

The consequence for the asset origin is concrete and belongs on both plans: it gains a root that is neither the working folder nor a mount the agent has. Whether the agent can *write* there through the ordinary mount set, or only through the tools that produce these files, is an open question — the tools already write them without the agent naming a path, so the narrower answer is available.

## Sequencing across the plans

Four plans now interlock, and the order matters more than usual because two of them change what a path means. The dependencies are narrower than they look:

1. **Split the task id from the task title** (above). Small, self-contained, and a prerequisite for both storage and the origin work. Nothing else should start before it, because both of the following choose durable names.
2. **[The folder work's phases 1 and 2](user-chosen-working-folder.md#phases)** — the `WorkingDir` brand, then the mount rename with the asset origin moving in the same change. This is what makes "the agent's mount set" a thing that can vary per task rather than a constant.
3. **This plan's phases 1 through 3** — prototype the write path, introduce the storage seam, build the metadata index. Independent of the folder work and can run in parallel with it; Reference B is the evidence that the seam is worth having before the backing decision, not after.
4. **Conversation-scoped assets** need both: a conversation that owns a directory (this plan) and an origin that serves more than one root (the folder plan). It is the join point, and it is where the two plans stop being separable.
5. **[Presentation](presentation-syntax.md) and [chat file links](chat-file-links.md)** sit on top of all of it and are shippable ahead of it, because they extend a mechanism (a markdown link resolved against the asset origin) whose interface does not change even though everything under it does.

The one ordering trap: the agent's cross-conversation search capability (phase 6 here) reads much better after the folder work, because "find the task where I set up the deploy script" is far more useful when tasks are associated with real folders the user recognizes than when they are associated with directories we invented.

## Options

| Option                                                        | Cross-task search       | Agent can read it directly | Delete removes the data | Cost   |
| ------------------------------------------------------------- | ----------------------- | -------------------------- | ----------------------- | ------ |
| **A.** Per-task SQLite (today)                                | Fan-out over N files    | No                         | Yes, per folder         | Zero   |
| **B.** One central SQLite                                     | Single query            | No, still a blob           | Needs cascade rules     | Low    |
| **C.** Per-task SQLite plus a central metadata index          | Fast                    | No, still a blob           | Yes                     | Medium |
| **D.** JSONL per conversation as truth, plus a metadata index | Fast, and ripgrep works | Yes                        | Yes, per file           | Medium |

D is cheaper than this document previously claimed, for one specific reason: **the index does not need to index content.** Content search is ripgrep over the JSONL. The index only carries what a list view needs (title, timestamps, counts, cost, sort keys) plus offsets for seeking. That removes FTS, content indexing, and content staleness from the design entirely.

**The cost column deliberately excludes migration.** We are in private beta with a handful of users, so conversion effort and the risk of losing old conversations are close to free right now, and they are the main thing that would otherwise make B look cheap and D look expensive. Judge these on the end state they produce, not on how hard they are to reach from here. See [Timing](#timing).

We already ship the required binary. Studio bundles and verifies ripgrep at package time ([verify-ripgrep.ts](../../../apps/studio/electron-builder/verify-ripgrep.ts)), and the agent already has a `Grep` tool.

## Recommendation

**Pursue D, structured as Reference A structures it**, with C as the fallback if the prototype's write path disappoints.

Specifically:

- One append-only JSONL per conversation, in application data, as the source of truth.
- A single central SQLite index holding list-view metadata plus `(ordinal, byte offset)` per item, so readers seek instead of replaying.
- The index is rebuildable from the files, and a rebuild path exists and is tested from day one. Not "we could rebuild it," but a function that does.
- Content search is ripgrep against the JSONL directory, joined to the index for ordering and pagination, with an in-process scan fallback.
- Entries are append-only with parent pointers, so message editing and branching are natural rather than destructive.

The property worth preserving is the one the current design gets right: no orphaned hidden state, and deleting the thing deletes the data. D preserves it by changing the unit from "one folder per task" to "one file per conversation." The index self-heals because it is derived.

If the prototype shows the write path cannot take it, C is the honest fallback: it keeps every current property, adds the central metadata index (which is needed under D anyway), and gives up only the agent's direct read access. Note that C should win on measurements or not at all. Much of its appeal is that it disturbs less, and right now disturbing less is worth very little.

## Timing

This is the cheapest this change will ever be, and the cost curve only goes one way. A handful of beta users means a botched conversion costs an apology, not an incident. Every month of growth adds conversations we are obliged to carry forward, and the obligation is permanent once it exists.

That is a scheduling argument, not just a reassurance. This plan is separable from the folder work, which makes it easy to defer indefinitely. It should not be deferred past the point where a breaking storage change stops being free. If the direction is right, the window to take it cheaply is now.

The corollary is that we should not build compatibility scaffolding we would only need for users we do not have. No dual-write period, no long-lived reader for the old format, no fallback path that lives in the codebase for a year. A one-shot converter that runs once and is then deleted is the correct shape, consistent with the repo's existing preference for structural changes over compatibility shims before general availability.

## Risks, and what to prototype

- **Write amplification during streaming.** Message parts are written and rewritten continuously through a turn. Appending updates and folding on read is the standard answer, and byte offsets keep the read cheap, but this needs measuring against a real long session before anything is committed. **This is phase 1 and nothing else starts until it has a number.**
- **Unbounded growth.** Append-only logs only grow. Reference A added a background compression worker and then had to make search compression-aware. Assume this cost rather than discovering it.
- **JSON escaping for search.** Grepping a JSONL file for user-visible text means escaping the search term to match JSON encoding. Easy to get wrong, and wrong in a way that silently returns nothing.
- **Atomicity.** SQLite gives crash-safe writes for free. Appends need a reader that tolerates a torn trailing line rather than treating it as corruption.
- **Concurrent writers.** Multiple app instances (and multiple dev worktrees) can target one store. Reference A uses lockfiles per thread. Our single-instance lock covers packaged builds but is explicitly skipped in dev.
- **Windows path length.** Few, shallow files rather than a deep tree. See [windows-long-paths.md](../../findings/windows-long-paths.md).
- **Migration.** One-time, forward-only, from N task databases to N conversation files plus one index. Follow the pattern in [migrate-workspace-layout.ts](../../../packages/workspace/src/lib/migrate-workspace-layout.ts): idempotent, sentinel-guarded, never clobbering, non-fatal on failure. Safe at boot, because it is a read-and-rewrite within application data. **Deliberately best-effort:** a conversation that fails to convert should be logged and skipped, not repaired. Given the user count, the effort of making conversion bulletproof exceeds the value of what it protects, and the converter is deleted after one release either way.

## Phases

0. **Split the id from the title.** A generated time-sortable id as key, filename, and origin label; today's prompt-derived slug becomes an editable `title` field. Small, and it gates everything after it, because phases 1 and 4 both choose durable names.
1. **Prototype the write path.** Append-and-fold with byte offsets, against a real long session. Measure turn latency, file size, and time to open a conversation. Decide D versus C on the numbers.
2. **Introduce the storage seam.** Make `getSessionsStoreStorage` return an interface rather than an unstorage instance. Worth doing regardless of the outcome, and Reference B runs two backings behind exactly this contract today.
3. **The metadata index.** Central, rebuildable, with the rebuild tested. This is needed under both D and C, so it is not a bet.
4. **New backing store** behind the seam. Swap outright rather than running both; there is no population to keep on the old path.
5. **One-shot converter**, sentinel-guarded, best-effort, deleted a release later.
6. **Agent capability.** Search over history via the existing grep tooling, then reorganization.

Phases 2 and 3 pay off under either option, so the irreversible choice happens at phase 4, after the prototype has produced numbers. That is the only gate worth having. The usual second gate, "can we bring everyone across safely," does not apply at this size and should not be allowed to add phases.

## Open questions

- Does the file format target readability by a person, or only by tools? JSONL greps well and reads poorly. Markdown reads well and loses structure. Pragmatic answer: JSONL as truth, markdown export on demand, which is roughly what `session-transcript` already produces.
- Do conversation files live in application data, or in the visible folder the folder plan may introduce? Application data is the safer default; putting them in a synced folder reintroduces the whole hazard set that rules out a user-visible workspace root: sync conflicts over SQLite and its WAL sidecars, file counts that make the folder unbrowsable, and a macOS consent prompt on a directory the app needs at boot. All four references keep them in application data, including the three that make the working directory part of the storage path — none of them stores a conversation *inside* the folder it is about.
- Does the agent get raw file access to its own history, or a search tool over it? Raw access is the point, but it means the agent can read every past conversation. That is a privacy posture decision, not a technical one, and it should be made deliberately rather than inherited from a storage choice.
- Should the index be one database or several? Reference A splits by concern into separate migration sets and databases, which limits the blast radius of any single schema and keeps hot tables small.
- What happens to `task-database-query` and `session-transcript` once the data is readable? Both likely collapse into ordinary file reads, which is the clearest signal that the direction is right.
- Does project identity come from the repository (Reference C hashes the initial commit) or from the path? The repository answer is strictly better where one exists and undefined where one does not, so the real question is what the fallback is for the non-code tasks that are most of our usage.
- Can the agent write to the conversation's own asset directory through the ordinary mount set, or only indirectly through the tools that produce those files? The narrower answer is already available, since nothing currently makes the agent name those paths.
- Does content search use ripgrep over files (Reference A) or FTS5 with triggers (Reference B)? Both are now represented in the prior art. Ripgrep needs no index and no staleness story but requires JSON-escaping the query; FTS5 ranks and paginates natively but must be maintained on every write.
