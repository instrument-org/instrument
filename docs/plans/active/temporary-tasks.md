# Plan: temporary tasks

Status: designed, not started. Owner: TBD.

Related, because both move where conversation data lives and would change the mechanism below if they land first: [conversation-storage.md](conversation-storage.md) and [user-chosen-working-folder.md](user-chosen-working-folder.md). Related on the claim rather than the code: [privacy-first-diagnostics-and-feedback.md](privacy-first-diagnostics-and-feedback.md), whose carve-out about the hosted model path applies here verbatim.

## Summary

A **temporary task** is an ordinary task whose conversation is never written to disk and whose folder is deleted when the app quits. It runs code, installs dependencies, drives the browser, and writes files exactly like any other task. The only thing it does not do is persist.

It is a task property, not a window: temporary tasks appear in the sidebar with their own icon and carry a persistent explanation in the task header. There is no separate window, no separate app instance, and no separate workspace root.

## Terminology

The user-facing and code-level word is **temporary**, everywhere: copy, ids, types, routes, telemetry, and on-disk layout, per the repository's rule that one concept gets one word.

Deliberately not "incognito": that is a browser's word for a browser's guarantee, and a browser can promise that nothing is persisted because a browser produces nothing the user asked to keep. Ours writes real files on purpose. Deliberately not "private" either: it reads as a claim about who can see the data, which is false while prompts transit the hosted gateway. "Temporary" is a claim about duration, which is exactly what is delivered.

The cost of not borrowing a familiar word is that the term arrives with no pre-loaded mental model, so the explanation has to do work the word does not. See [Copy](#copy).

## The guarantee

Three tiers, graded by sensitivity. Two of the three are crash-proof.

| Tier | Data | Held where | Survives a crash | User can keep it |
| --- | --- | --- | --- | --- |
| 1 | User messages, agent responses, reasoning, tool inputs and outputs, session titles, prompt draft, task title, folder name | Memory only | No, never written | No |
| 2 | `work/`, `.tool-output/`, screenshots, downloads, attachments, `node_modules`, `.venv` | Task folder on disk | Until the next launch | No user-facing path in v1 |
| 3 | Cookies, cache, localStorage, IndexedDB, service workers | Memory, per task | No, never written | No |

Tier 2 is the analog of a browser's downloads folder, and the handling is stricter than the browsers': Chrome retains files downloaded in incognito indefinitely and discards only the history entry. Tier 3 is stricter as well, because each temporary task gets its own isolated session where a browser shares one profile across all private windows.

What this does **not** cover, and what the copy must therefore not imply:

- **The network.** The model path is unchanged. On the default model the conversation transits the hosted gateway; web search reaches the hosted backend even on a user's own provider keys; provider-side prompt caching retains the prefix for its TTL.
- **Attached folders.** If the user attaches a real folder, the agent's writes there are permanent and outside every tier above.
- **Skills and project instructions.** A temporary task may author a skill or edit a project `AGENTS.md`, and those persist. This is intended: the user asked for it, and restricting it would be a larger change than the feature warrants.
- **The main log.** Lines emitted during the task remain in the rotating log.

## Design

### Identity: the id carries the flag

A temporary task's id, which is also its folder name and the DNS label of its asset origin, takes the form:

```
2026-08-15--temporary-p7k3m9x2
```

Three properties, each load-bearing:

**The date stays first**, so a listing of the workspace folder remains chronological alongside normal tasks. Note that the product's task list does not sort by folder name at all; it sorts by `lastActivityAt` and `createdAt`, which for a temporary task come from memory and behave identically. The ordering benefit is for a human browsing the folder on disk.

**The double hyphen is unforgeable.** [`taskFolderSlug`](../../../packages/workspace/src/lib/task-folder-slug.ts) matches `/[a-z0-9]+/g` and joins tokens with exactly one hyphen; [`generateTaskFolderName`](../../../packages/workspace/src/lib/generate-task-folder-name.ts) joins the date prefix with exactly one hyphen and appends collision suffixes as `-N`. No path through the normal generator produces two adjacent hyphens, whatever the user types, so `id.includes("--")` is a total and unspoofable predicate. A prompt of literally "temporary p7k3m9x2" still yields `2026-08-15-temporary-p7k3m9x2`, one hyphen, correctly treated as a normal task. No reserved-word list, no escaping, no guard code. [`SubdomainPartSchema`](../../../packages/workspace/src/schemas/subdomain-part.ts) is `/^[a-z0-9-]+$/`, so the form validates with no schema change, and the punycode `xn--` reservation binds only at positions three and four, which a date prefix never occupies.

**The suffix is opaque, not a prompt slug.** A normal task id is derived from the user's first message, which would put message content in the one place a delete-on-quit design cannot hide it, and in the asset origin's hostname. Temporary tasks get a generated identifier instead.

Putting the flag in the id rather than in a settings field or a marker file is what makes the rest cheap:

- **No extra disk reads.** [`get-tasks`](../../../packages/workspace/src/lib/get-tasks.ts) already globs `tasks/*/` and already parses each folder name into a `TaskId`. The predicate is a string test, not a `stat`.
- **It cannot be toggled onto an existing task.** Turning it on would mean renaming the folder, which changes the primary key, the asset origin label, and every reference to the task. The property is structural rather than a bit somebody can flip into a data-loss bug.
- **It cannot drift out of sync.** A settings field and a folder can disagree; a folder cannot disagree with itself.
- **It survives when nothing else does.** Because settings live in memory (below), the name is the only thing left on disk after a crash, so it is the only viable candidate.

### Storage: swap the backing, not the callers

**Conversation.** [`getSessionsStoreStorage`](../../../packages/workspace/src/lib/session-store-storage.ts) is the only place in the repository that opens a task database, and everything above it speaks the five-method `WrappedStorage` contract over a flat key space. For a temporary task it returns an [unstorage](https://unstorage.unjs.io) memory driver instead of the `db0` sqlite one. No caller changes.

Do not attempt this by suppressing writes. The store is not a write-behind log; it is the source of truth for the live transcript, which the renderer re-reads on every streaming batch, and for the next turn's model input, which [`prepare-model-messages`](../../../packages/workspace/src/lib/prepare-model-messages.ts) rebuilds from it. Silencing the writer produces an empty chat and an agent with no memory. Swap the backing and keep every write.

**Settings.** Give task settings the same shape of seam the store already has: one contract, two backings, chosen by the predicate. This covers `state.promptDraft`, which is written as the user types and is an unsent user message, and `settings.name`, which is generated from the first user message and is therefore a compressed summary of the conversation. Both are tier 1 and would otherwise reach disk through a side door while the database sat safely in memory.

During a run the flow is unchanged: `get-tasks` globs the folders, and for a temporary id the adapter serves settings from memory rather than reading the file. Timestamps, title, unread state, pinning, and sort order all work as they do today.

**Pinning is kept.** It is coherent within a session for someone organizing a day's work, even though it means nothing after quit.

### Browser: one in-memory session per task

An Electron partition name without a `persist:` prefix is an in-memory session, and distinct names are distinct sessions. Keying the partition on the task id therefore gives per-task account isolation and zero bytes on disk at the same time: a user can sign into the same service under three different accounts in three temporary tasks, and nothing needs cleaning up, including after a crash.

This replaces [`session.fromPath`](../../../apps/studio/src/electron-main/browser-view/manager.ts) for temporary tasks. The `partitionDir` field threaded through the browser view entry, manager, debug snapshot, and tests becomes a directory-or-name union. That is the one place this feature touches typed plumbing.

If some Chromium capability turns out to require a real profile directory, the fallback is a per-task directory at `<task>/.instrument/browser-session/`, which is masked from the agent's filesystem and which [`export-task-zip`](../../../packages/workspace/src/lib/export-task-zip.ts) already excludes by that exact task-relative path. Taking the fallback moves tier 3 into tier 2 and reintroduces cleanup, so prefer the in-memory form.

### Deletion: rename first, reap after

A task carrying `node_modules` and a virtual environment is tens of thousands of files. Blocking quit on that removal is what makes people force-quit, which is exactly when cleanup does not finish.

1. **Rename** `tasks/<id>` to `tasks/.reaping-<id>`. One atomic operation regardless of size. Because `get-tasks` globs `*/` and glob skips dot-prefixed entries by default, the task leaves the product the instant the rename lands. Confirm this against the broken-task sweeper in Settings, Storage, so a folder being reaped is never surfaced as a corrupted task.
2. **Reap** with a recursive removal in the background, after quit or at the next launch.

Reuse the ordering already established in [`trash-task`](../../../packages/workspace/src/lib/trash-task.ts), which is load bearing and hard won: wait for the browser view and the agent-browser daemon to reap so the profile is unlocked, dispose the store handle, and remove `node_modules` first because pnpm hard links break deletion on Windows. Removing the automatic runtime boot behavior will shrink the `node_modules` pressure that motivated that ordering, but rename-then-reap remains correct regardless, because it is about not blocking quit rather than about size.

Delete with a real recursive removal, **not** `shell.trashItem`. The current path files a deleted task into the system trash, which for a temporary task would be a comic failure.

### Boot sweep

At launch, delete every folder under `tasks/` matching either `*--temporary-*` (crashed before the rename) or `.reaping-*` (crashed mid-reap). Both patterns are matched against a glob that already happens, so the sweep costs nothing beyond the removal itself.

The sweep must run **before** the first task list is built and **before** [`migrateWorkspaceLayout`](../../../packages/workspace/src/lib/migrate-workspace-layout.ts) walks the folders. Otherwise a crashed temporary task briefly appears in the sidebar, or gets normalized on its way to being deleted.

No registry, no marker file, and no state that has to have survived the crash.

## Copy

The word carries no built-in mental model, so two surfaces have to supply one.

**Task header, persistent.** Not only a badge. Something like: "Temporary task. Deleted when you quit Instrument."

**Creation disclosure, once.** Along the lines of: "Your conversation is never written to this computer. Files this task creates are deleted when you quit. Sites you sign into are forgotten, and other tasks never see them. This does not change how your messages reach the model."

Keep that last sentence even when it is tempting to drop. It is the carve-out that [privacy-first-diagnostics-and-feedback.md](privacy-first-diagnostics-and-feedback.md) argues should be stated by us rather than discovered by somebody else.

"Your conversation is never written to this computer" is accurate without qualification in v1, because there is no user-facing path that writes a transcript out. Should conversation export become user-facing later, it arrives with its own opt-in disclosure and this sentence gains "unless you export it".

## Build order

Item 1 first, because everything else reads the predicate.

| # | Change | Where | Size |
| --- | --- | --- | --- |
| 1 | `--temporary` id form plus an `isTemporary(id)` predicate | [`generate-task-folder-name.ts`](../../../packages/workspace/src/lib/generate-task-folder-name.ts), [`task-id.ts`](../../../packages/workspace/src/schemas/task-id.ts) | Small |
| 2 | Memory driver behind the existing storage seam | [`session-store-storage.ts`](../../../packages/workspace/src/lib/session-store-storage.ts) | Small |
| 3 | Settings adapter, memory or file backing, plus the naming refactor below | [`task-record.ts`](../../../packages/workspace/src/lib/task-record.ts) | Medium |
| 4 | Per-task in-memory partition; `partitionDir` becomes a directory-or-name union | [`browser-view/`](../../../apps/studio/src/electron-main/browser-view/) | Medium |
| 5 | Rename-then-reap deletion, recursive removal rather than the system trash | [`trash-task.ts`](../../../packages/workspace/src/lib/trash-task.ts) | Small |
| 6 | Quit hook and name-pattern boot sweep, ordered ahead of the layout migration | [`create-workspace-actor.ts`](../../../apps/studio/src/electron-main/lib/create-workspace-actor.ts) | Medium |
| 7 | Disable zip export for temporary tasks | [`rpc/routes/task/`](../../../packages/workspace/src/rpc/routes/task/) | Tiny |
| 8 | Stale-task landing state after a restart; exclude from recently-closed tabs | [`atoms/tabs.ts`](../../../apps/studio/src/client/atoms/tabs.ts), router | Small |
| 9 | Sidebar icon, header sentence, creation disclosure, new-task entry point | `client/components/` | Small to medium |

Sizes are estimates from reading the code, not measurements. Nothing on this list reaches the agent, the tools, the sandbox, the asset origin, or `taskDir()`, which stays a pure join because temporary tasks live in the ordinary tasks directory.

### The adjacent refactor

Item 3 is the right moment to rename `task-record` and its exports, because the file is being opened to have a seam put in it and a seam is easier to name well than to rename once callers depend on it. Worth folding in: the file and function names, the settings-versus-state split that the adapter has to model explicitly, and naming the storage contract so it visibly pairs with the one the session store already uses.

Worth resisting: reshaping the settings schema, which is a migration; the broader task id and title split, which [conversation-storage.md](conversation-storage.md) should own; and anything that makes the diff hard to review, since this is the file where a subtle mistake loses someone's draft.

## Deliberately out of v1

- **Promote a temporary task to a permanent one.** No comparable product offers it, and it is the one action that converts tier 1 into tier 2.
- **Zip export.** Its payload is a real database file, so supporting it would require materializing the in-memory key space. Cut instead. Markdown transcript export is developer-mode only and reads the same store the UI reads, so it works against the memory driver without a materializer and needs no action here.
- **A memory ceiling or spill strategy.** Parts accumulate in memory for the life of a task, and large tool outputs already spill to `.tool-output/` and are referenced by path. Accepted as-is; a very long temporary task that exhausts memory is a lesson rather than a bug to pre-solve.
- **Telling the agent it is in a temporary task.** It invites divergent behavior, such as trying to persist work elsewhere, which would break the user's expectation more than the ignorance costs. Revisit when the agent gains meta operations over tasks on disk, at which point the framing is "everything is the same, but this is deleted on exit", explicitly not "behave differently".
- **Continuing an existing task privately, or branching privately.** The existing transcript is already on disk, so the promise would be false.
- **Restricting skills, projects, or attached folders.**
- **Anything about telemetry.** [privacy-first-diagnostics-and-feedback.md](privacy-first-diagnostics-and-feedback.md) is replacing ambient events with client-held, user-attached reports, which resolves the gap without this feature acting.

## Risks

- **Crash residue for tier 2.** Between a crash and the next launch, a temporary task's files sit in the workspace. This is a weaker promise than a browser makes, and it is the direct cost of the agent being able to run real work. The copy says "deleted when you quit" rather than "never written" for this tier, which is accurate.
- **The asset origin serves temporary task files.** `assets.<taskId>` is reachable by any local reader while the app runs and is not authenticated. Not new and not made worse here, but it now sits inside a feature whose premise is privacy, so it belongs on the known-limitations list. The opaque id at least keeps the prompt out of the hostname.
- **The storage plans would change this.** [conversation-storage.md](conversation-storage.md) moves conversations into a central index, at which point "delete the folder, delete the data" stops being true and temporary tasks need their entries excluded or purged. Build against the storage seam rather than the file layout, and add a line to that plan when this lands.

## Acceptance criteria

- [ ] A temporary task runs code, installs dependencies, drives the browser, and writes files exactly like a normal task.
- [ ] No user message, agent response, prompt draft, task title, or session title appears anywhere on disk while a temporary task is live.
- [ ] The task's folder name contains no content derived from any prompt.
- [ ] `isTemporary` is a pure string predicate, and building the task list performs no additional file reads relative to today.
- [ ] Two temporary tasks can hold independent logged-in sessions with the same site, and neither is visible to a permanent task.
- [ ] Quitting removes the task from the sidebar immediately and does not block on removal.
- [ ] After a forced termination, the next launch removes both partially-deleted and never-deleted temporary task folders before any task list is built.
- [ ] A temporary task folder is never surfaced by the broken-task sweeper.
- [ ] Deleting a temporary task removes it from memory and from disk, and does not place it in the system trash.
- [ ] Closing a temporary task's tab does not delete it; only an explicit delete does.
- [ ] Zip export is unavailable for temporary tasks.
- [ ] A normal task whose prompt slugs to `temporary-<something>` is not treated as temporary and is never swept.
- [ ] The creation disclosure states the model-path carve-out.
