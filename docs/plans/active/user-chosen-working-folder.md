# Plan: folders decoupled from tasks, writable in place

Status: proposal, not started. Owner: TBD. Supersedes an earlier proposal to move the workspace root into the user's documents directory; see [Why moving the workspace is unnecessary](#why-moving-the-workspace-is-unnecessary). Conversation data is a separate axis, planned in [conversation-storage.md](conversation-storage.md).

## Summary

Four changes, in dependency order:

1. A folder is **something a task refers to, not something a task is**. Tasks stop owning a directory by construction.
2. A task can target **a folder the user picks**, most likely by way of a project rather than per task.
3. That folder is **writable in place**. Read-only attachment becomes an option, not the posture.
4. Our own state (task database, session state, temp, screenshots, downloads) **stays in the application-data directory** and never moves into user-visible space.

The point is not to relocate the workspace. It is to stop the workspace from being where the user's work lives, at which point the question of where to put the workspace mostly stops mattering.

## Why

Today `tasks/<id>/` serves three purposes with one directory: the user's deliverables (`output/`), the agent's work area (`work/`, including `node_modules` and `.venv`), and our private state (`.instrument/task.db` with its WAL sidecars, `state.json`, `.state/`). Those three want mutually incompatible homes, which is why every route to making the workspace user-visible runs into the same wall.

There is also a directness problem that the current model cannot express. A user who wants the agent to work on files they already have has exactly two routes: attach a folder to a message, or attach folders to a project. Both are read-only, so the agent cannot edit what it was given. The documented workaround is copying: "read-only mounts must be copied into the task before native tools can process them" ([bash-sandbox-mounts-and-native-binaries.md](../../architecture/bash-sandbox-mounts-and-native-binaries.md)). That produces duplicates the user did not ask for, in a location they did not choose, while their real files stay untouched. The safety win is small and the usability cost is large.

A directory per task is also a poor fit now that most tasks are not projects. It made sense when every task was a runnable app. A conversation that never touches a file still gets a directory, a database, and a state file.

## Current model

| Concern                      | Where it lives now                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task directory               | Derived, not stored: `taskDir(id)` in [task-dir-utils.ts](../../../packages/workspace/src/lib/task-dir-utils.ts) joins the workspace singleton's `tasksDir` with the task id |
| Agent's writable root        | The task dir, mounted at `/task` ([workspace-fs-layout.ts](../../../packages/workspace/src/lib/workspace-fs-layout.ts))                                                      |
| User folders                 | Copied in as attachments, or mounted **read-only** under `/mnt/<name>` ([attached-folder-mounts.ts](../../../packages/workspace/src/lib/attached-folder-mounts.ts))          |
| Temp, screenshots, downloads | Under the task dir, via `getTaskTmpDir` / `getScreenshotsDir` / `getDownloadsDir`                                                                                            |
| Native binaries              | Bridged to real host paths for `/task` **only**; every other virtual path quarantines to a nonexistent path inside the task dir                                              |

## Target model

| Layer                          | Contents                                                                                                     | Visible to user         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Application data (`userData/`) | Task database, session state, per-task scratch when requested, temp, screenshots, downloads, browser session | No, and deliberately so |
| The user's chosen folder       | The actual work. Read and written in place                                                                   | It is already theirs    |
| `~/Documents/Instrument/`      | Deliverables only, from tasks that never connected a folder                                                  | Yes                     |

The third layer is the only new user-visible directory and it is optional. It holds finished files and never the working mess, which is what makes the documents directory the right home rather than the hazard it would otherwise be. See [Where the visible output folder goes](#where-the-visible-output-folder-goes).

## The five structural changes

### 1. The working directory becomes stored state

This is the crux, and it is bigger than it looks. `taskDir(id)` is a **pure derivation** off the workspace singleton, with the task id doubling as the folder name. Every consumer assumes that. A user-chosen folder cannot be derived from an id, so the working directory has to become a stored, per-task value that is read rather than computed.

Concretely, one concept splits into two:

- `taskDir` (ours, private, still derived from the id, always under `tasksDir`): database, state, temp, screenshots, downloads.
- `workingDir` (the user's chosen folder, or a created scratch dir, or absent): the agent's read/write surface.

Everything in [task-dir-utils.ts](../../../packages/workspace/src/lib/task-dir-utils.ts) that currently takes a `TaskDir` needs auditing for which of the two it meant. The `TaskDir` brand in [paths.ts](../../../packages/workspace/src/schemas/paths.ts) is the right lever: introduce a distinct `WorkingDir` brand so the compiler finds the call sites instead of us finding them by hand. Persist the chosen path in task settings; `AbsolutePathSchema` is already the established shape for a stored host path ([folder-attachment.ts](../../../packages/workspace/src/schemas/folder-attachment.ts)).

Expect this step to touch more files than the rest of the plan combined, and expect it to be almost entirely mechanical once the brands are in place.

### 2. A writable mount that we do not own

The filesystem layer is closer to ready than expected. `WorkspaceFsMount` already carries a per-mount `readOnly` flag, and `buildBashFs` already threads it through to `OverlayFs({ readOnly: mount.readOnly })`. A writable user folder is expressible today by constructing the mount with `readOnly: false`.

Two things are not ready:

- **`WorkspaceFsLayout.task` is typed `{ hostRoot: TaskDir; readOnly: false }`**, hard-coding the assumption that exactly one writable mount exists and that it is ours. The layout needs a second writable mount, or a redefinition of which mount is the working root.
- **The native-binary bridge is the delicate part.** `resolveNativeHostPath(taskHostRoot, virtualAbsPath)` takes a single host root and bridges `/task` alone; everything else quarantines to a nonexistent path so a subprocess fails not-found instead of touching the host. That contract is load-bearing and its comment explicitly warns against resolving against the full layout. But `python`, `ffmpeg`, and `pnpm` must be able to operate on the user's folder, or the feature is worthless. The rule has to be restated rather than relaxed: **bridge writable mounts to their real host path; quarantine read-only mounts and the private dir exactly as today.** Rewrite the comment to say that, so the next reader does not "restore" the old invariant. This deserves its own tests in `workspace-fs-layout.test.ts` alongside the existing EROFS and quarantine cases.

  Keeping read-only sources as a first-class concept (see change 3) matters here: it means the quarantine branch stays live and exercised rather than becoming dead code that quietly rots. The change is "one more writable root," not "any mount may now be writable."

**Recommendation: do not rebind `/task` to the user's folder.** It is the tempting one-line version, and it is wrong: `getTaskTmpDir`, `getScreenshotsDir`, and `getDownloadsDir` all derive from the same root, so rebinding scatters `tmp/`, `screenshots/`, `downloads/`, and `.instrument/` through a folder the user cares about. This also matches how a comparable product structures it: a private per-session working directory, plus separately mounted user folders.

#### Proposed mount names

Three rules, each structural rather than a flag the model has to remember:

| Mount         | Backed by                                                                         | Access                          | Present when                           |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- |
| `/work`       | The user's connected folder, or an on-demand private directory when there is none | Writable. The working directory | Always                                 |
| `/scratch`    | A private directory in application data                                           | Writable                        | Only when `/work` is the user's folder |
| `/mnt/<name>` | Source folders                                                                    | Read-only, always               | Any sources attached                   |
| `/skills`     | Workspace skills                                                                  | Writable, unchanged             | Unchanged                              |

The value of this shape is that **writability is a property of which root you are under**, not a per-mount flag the agent has to recall. `/mnt` is always read-only, with no exceptions and no variants, which is why splitting it into a writable and a read-only flavor is worth avoiding: two mount roots that differ only by permission is exactly the ambiguity that produces confident wrong writes. A model that can see `/work` and `/mnt` never has to ask which one it may write to.

`/work` keeping one name across both backings is the answer to "does the working folder replace `/task`." The mount name is stable, the backing directory is not, so prompts and tool descriptions stop caring whether a folder was connected. `/task` retires as a name, since it would describe our private directory in some cases and the user's real folder in others.

`/scratch` exists so the agent has somewhere to build without polluting a folder the user owns. Its concrete first job: `TMPDIR`/`TEMP`/`TMP` currently point inside `work/` via `getTaskTmpDir`, and they must not point inside a user's folder.

### 3. Two concepts, not one concept with a permission flag

**Decided: read-only attachment stays exactly as it is, as "sources." A separate affordance is added for working in a folder, which is writable.**

The two differ in cardinality and lifetime, not just in access level. Sources are many, added and dropped freely, often per message, and read-only is correct for them. A working folder is one (or a small set owned by a project), chosen deliberately, stable for the life of the work, and it orients the agent. Modelling that as an item in the attachment list with a write toggle would make every reference attachment a decision about write access that nobody wanted to make.

Three consequences worth having in the plan:

- This is **additive**. Nothing about `assignAttachedMounts`, `assign-folder-names`, the `/mnt/<name>` naming, or read-only symlink containment changes. Existing tasks and their attachments are untouched.
- The read-only code path stays live, which keeps the native-bridge quarantine branch exercised rather than vestigial.
- The layout stays general (mounts carry `readOnly`; the bridge honors it) while the product stays specific (sources are read-only, working folders are writable). Do not encode "exactly one writable mount" as a type-level constraint: a project owning several working folders is a plausible next step, and a comparable product allows exactly that.

The reason writable is right at all: today the agent's only answer to "edit these files" is to copy them into the task and edit the copies. That is not safer in a way that matters; it leaves the user with duplicates and unchanged originals.

The safety budget moves to where the user can act on it:

- **At the door.** Connecting a folder for writing is an explicit, legible moment. That is also where the macOS consent prompt naturally lands, in response to a user action rather than at silent boot.
- **After the fact.** A visible record of what changed, and a way back. Both comparable products have a restore path. Git-initializing the folder is the cheap version and carries its own surprises in a folder the user may already track.

Still required regardless, because they are not user-visible decisions:

- Containment for writes, matching the symlink containment reads already have, so a symlink inside the connected folder cannot be used to write outside it.
- A distinction in the change record between creating new files and deleting or overwriting pre-existing ones. They are different acts and should not be reported identically.

### 4. Two file mechanisms, for two different jobs

Today one mechanism does both jobs, because we own the directory: scan it, and whatever changed is what the agent did. That inference dies the moment the user can edit the same folder mid-run. Split it deliberately.

**The watcher survives, for browsing.** A live file tree over the working folder is a genuinely good affordance, and it needs the watcher. [get-task-files.ts](../../../packages/workspace/src/lib/get-task-files.ts) ignores `node_modules`, `.venv`, and friends because a Python scientific stack alone runs past the index cap; that ignore list was tuned for a directory whose shape we knew. Pointed at a monorepo it needs a cap strategy and probably lazy per-directory expansion rather than a whole-tree index.

**Attribution comes from somewhere else.** "What did the agent change this turn" cannot come from the watcher any more, because a user edit and an agent edit are the same inotify event. It has to come from the agent's own actions.

**We can attribute more than "tool calls" implies, because our bash is not a real shell.** just-bash executes against a virtual `IFileSystem` we supply, so every mutation a shell command makes goes through an interface we control. The mechanism already exists and is already in production: [skill-write-tracking-fs.ts](../../../packages/workspace/src/lib/skill-write-tracking-fs.ts) wraps a filesystem and records `writeFile`, `appendFile`, `mkdir`, `rm`, `mv`, `cp`, `link`, `symlink`, `chmod`, and `utimes` without changing behavior, and it is already mounted on `/skills` in [workspace-fs-layout.ts](../../../packages/workspace/src/lib/workspace-fs-layout.ts). Wrapping `/work` in the same tracker gives per-turn attribution across the file tools and the entire shell surface, for a small fraction of the cost of snapshot-and-diff.

The real gap is narrower than the whole shell: **real subprocesses.** `ffmpeg`, `python`, `node`, and `pnpm` run against the kernel through `resolveNativeHostPath` and never touch our virtual filesystem, so their writes are invisible to the tracker. That is a genuinely unsolvable case short of OS-level instrumentation, and it is the honest limit of what the change record can claim.

Recommended posture:

- Track the virtual filesystem, which covers file tools and shell built-ins. This is the primary record and it is cheap.
- Treat native-subprocess output as unattributed. Where a turn ran one, the record can say so rather than pretending completeness.
- Keep the watcher as the backstop: it sees everything, attributes nothing, and is the right substrate for a browsable tree and for a debug view of what actually moved on disk during a run.

Neither mechanism alone is complete, and saying so in the interface is better than a change list that quietly omits what a build step did.

### 5. Folderless tasks: split scratch from output

With no folder connected, the agent has nowhere to work and nowhere to put results. These are two needs, not one, and conflating them is what made the previous version of this plan reach for a visible `~/Instrument/` that would fill up with `node_modules`.

- **Scratch** is where the agent works: builds, dependency installs, temp files, intermediate junk. Application data, invisible, disposable, created on demand. This is what `tasks/<id>/work/` is today, minus the assumption that it always exists.
- **Output** is where finished deliverables go when there is no user folder to put them in. Visible, browsable, and containing only files a person would want.

That split resolves the location question rather than trading it off, and it changes the answer (see [Where the visible output folder goes](#where-the-visible-output-folder-goes)).

Also: task creation stops materializing a directory tree. A conversation that never touches a file should produce no directory at all.

Note the ordering constraint: the private directory currently also holds `task.db`, so "no directory until needed" is only fully reachable once conversation data stops living in a per-task file. That is [conversation-storage.md](conversation-storage.md), and it is why the two plans are related but separable. Until it lands, a fileless task still creates its private directory, which is invisible and cheap.

## Where the visible output folder goes

Earlier drafts put a visible folder at `~/Instrument/` rather than `~/Documents/Instrument/`. The justification:

**On macOS, the home directory root is not TCC-protected. Documents, Desktop, and Downloads are.** Since Catalina, Files and Folders protection covers those three for every app, sandboxed or not, and our hardened-runtime-but-unsandboxed build gets no exemption. First access raises a consent prompt; denial is a permanent `EPERM`. `~/Instrument/` sidesteps that entirely. The other two reasons were sync roots and file count, both of which assumed the folder would hold working files.

**With scratch and output separated, that reasoning inverts.** A folder holding only finished deliverables has no `node_modules`, no SQLite, and a small file count. Cloud sync of that folder is a feature rather than a hazard: syncing a person's finished documents is what the documents directory is for. What remains is the consent prompt, and the prompt is no longer a problem once access is requested in context (see below) rather than at boot.

**So: `~/Documents/Instrument/` for output, application data for scratch, and no `~/Instrument/` at all.** More discoverable, and the objections that ruled it out were objections to putting the working mess there.

Two caveats to keep: request access at the moment output is first written, never eagerly at boot; and add `NSDocumentsFolderUsageDescription` to `mac.extendInfo` in [electron-builder.ts](../../../apps/studio/electron-builder.ts) so the prompt has a reason string. On Windows the documents directory may be OneDrive-redirected, which for deliverables is acceptable and arguably desirable.

## Rich file presentation

Losing the automatic `output/` preview means the agent has to say what it wants shown. That grew into its own subject: the full design is in **[presentation-syntax.md](presentation-syntax.md)**. It is shippable ahead of the folder work and does not depend on it. What follows is the summary that this plan needs.

Half of it already ships: a markdown link renders as an interactive chip that opens an in-app preview ([TaskFileLink in markdown.tsx:175](../../../apps/studio/src/client/components/markdown.tsx#L175)), and the prompt already instructs the agent to use it ([main.ts:167](../../../packages/workspace/src/agents/main.ts#L167)).

What is missing is expressiveness. A single link cannot say "show these six images as a gallery," "embed this at full width," "here is the folder, browsable inline," or "preview this large." The goal is a richer authoring vocabulary the agent writes directly into its response, in the spirit of the embed syntaxes that note-taking tools use.

The same vocabulary then covers retrieval as well as production. "Here is where that lives in your folder" becomes the same gesture as "here is what I made," which collapses two mechanisms into one. It also generalizes past files: if the parsed result is a typed node with typed items, connector results and other agents' outputs reuse the same components without a second rendering path.

### The counter-position, which is worth taking seriously

A comparable desktop agent deliberately invents **no syntax at all**. It stays inside standard markdown links and images, pushes every bit of complexity into the href (`[auth.ts](/abs/path/auth.ts:42)`, angle brackets for paths with spaces, `:line:col` and `#L12` suffixes parsed out of the target), and reserves custom URL _schemes_ rather than custom grammar for non-file mentions (`app://`, `agent://`, `subagent://`). Their renderer strips backticks and parses suffixes; the model is told exactly which shapes are valid and never guesses.

That approach has a real advantage we should not give up lightly: **it degrades perfectly.** A link is a link in any renderer, at any point in a stream, in any copied-out transcript. Its limit is exactly our requirement, though. It cannot group. Six links in a list are six chips, not one gallery.

### Options

| Approach                                          | Groups | Named options         | Degrades to    | Model reliability             |
| ------------------------------------------------- | ------ | --------------------- | -------------- | ----------------------------- |
| Href-encoded, no new grammar                      | No     | Query-ish, awkward    | A working link | Highest                       |
| Wiki-style embeds, `![[path\|opts]]`              | No     | Positional only       | Literal text   | High, common in training data |
| Directives, `:file[path]{size=lg}` and `:::files` | Yes    | Yes                   | Literal text   | Unknown, needs testing        |
| Fenced block with a typed payload                 | Yes    | Yes, schema-validated | A code block   | High for JSON emission        |

### Recommendation

Layer by job rather than picking one winner:

- **One file, referenced in prose:** the existing markdown link. Do not touch it. It degrades perfectly and the model already emits it correctly.
- **One file, embedded with display options, or a group:** a single mechanism that offers both inline and block forms with one attribute grammar. Directives are the strongest candidate for this reason: `:file[report.pdf]{size=large}` inline and `:::files{layout=grid}` as a container come from one plugin, so we do not end up maintaining three parsers with three escaping rules. Our pipeline is already plain remark ([markdown.tsx:465](../../../apps/studio/src/client/components/markdown.tsx#L465) composes `remarkGfm` and `remarkBreaks`), so a directive plugin is a drop-in.
- **Fallback if directives prove unreliable to emit:** a fenced block with a Zod-validated payload. Verbose and it interrupts prose, but models emit JSON in fenced blocks extremely reliably, and validation failure has an obvious rendering (a code block) rather than a broken one.

Whatever wins, parse everything into one schema so the renderer has a single component family and one validation path.

### Two constraints that should decide this

**Choose it empirically, not aesthetically.** The binding constraint is not what the renderer can parse, it is what models reliably emit unprompted. Prototype two candidates, run them across models with the eval CLI, and read the transcripts. This is exactly the case the `validate-changes` guidance exists for: whether a model finds and correctly uses an affordance is not something unit tests can tell you.

**It has to survive streaming.** Responses render incrementally, so the parser sees `:::files{lay` before it sees anything closeable. Any custom syntax needs a defined mid-stream appearance, or the transcript flickers raw syntax while the model types. This favors constructs with a distinctive opening token that the renderer can recognize and suppress until complete, and it is a strike against anything whose opening is indistinguishable from ordinary prose. Coordinate with [incremental-live-transcript-updates.md](incremental-live-transcript-updates.md).

### One consequence elsewhere

[main.ts:160](../../../packages/workspace/src/agents/main.ts#L160) currently tells the agent _not_ to report real paths, because `/task` is a sandbox root and quoting it misleads the user. With a user-chosen working folder that guidance inverts: the folder is theirs, they know where it is, and naming a real path is helpful rather than misleading.

## Agent-requested folder access

A user will say "put this on my desktop" or "look at my documents folder." Today the agent has no move. It should be able to ask.

The shape: the agent calls a tool requesting access to a path, we surface a permission prompt in the chat stream, and on approval the path becomes a mount for that task, as either a source or the working folder. Denial is an ordinary tool result the agent can respond to.

This is worth building for its own sake, and it happens to solve the macOS problem in the cleanest available way. Routing approval through the native folder picker means the user's selection _is_ the grant, in an interaction the OS already understands, at a moment when the reason is obvious. It also gives one consistent mechanism for every protected location rather than special-casing Documents, Desktop, and Downloads separately.

It should reuse the same prompt component as user-initiated folder attachment, so consent looks identical whoever initiated it.

## What breaks, and what to do about it

- **`export-task-zip`** assumes a task is one self-contained directory. When the work lives in the user's folder, exporting means transcript plus references, not a folder. Decide whether export means "the conversation" or "the conversation and a copy of the files."
- **The `output/` preview convention.** Files written to `output/` automatically become previews ([main.ts:234](../../../packages/workspace/src/agents/main.ts#L234)). That rule dies with the magic directory. Its replacement is [Rich file presentation](#rich-file-presentation) above.
- **Two folder concepts need two names.** Sources (read-only, many) and the working folder (writable, singular) are deliberately distinct, so the risk is not blurred semantics but two affordances that look alike. This is a vocabulary problem before it is a code problem. Flagged for design.
- **Concurrency: accepted, with a narrower residual risk.** Two tasks sharing a working folder is allowed. Scratch is per-task and created on demand, so the tooling never collides; what remains is two agents editing the same file, which is the same hazard as a person editing alongside an agent and wants the same answer (a visible change record) rather than a lock. Not worth serializing tasks over.
- **Tool-output spill logs** live under `work/` so the agent can read back paths it was handed. If `work/` is no longer guaranteed to exist, that path needs a private home.

## What does not change

- The database, session state, and browser session stay in application data. No SQLite in synced folders, no `node_modules` in the documents directory, no TCC prompt at boot.
- No data migration. Existing tasks keep their current directory as their working directory; the new path applies to new tasks.
- The `/skills` mount, unchanged. `/mnt` keeps its read-only semantics with no exceptions; what changes is that a writable root exists elsewhere.
- The explicit file-link mechanism. Markdown links already render as preview chips; that path is extended, not replaced.
- Conversation storage. Per-task databases stay as they are until [conversation-storage.md](conversation-storage.md) is scheduled on its own.

## Phases

1. **Split the concept.** Introduce the `WorkingDir` brand, make the working directory stored rather than derived, and set it to today's task dir for every task. No behavior change, no UI. This is the refactor that makes the rest small.
2. **Mount rename and the bridge rule.** `/work` and `/scratch` replace `/task`; the layout supports a second writable mount; `resolveNativeHostPath` bridges writable mounts and keeps quarantining read-only ones; `TMPDIR` moves to `/scratch`; tests pin both halves.
3. **Presentation.** Extend the existing link mechanism to folders and file sets, add the artifact-panel tool, and delete the automatic `output/` preview rule. Independent of the folder work and shippable on its own.
4. **Safety.** Write containment, the change record, restore story. Depends on the bash-attribution decision.
5. **The picker.** Folder connection, recent folders, project grouping, persistence.
6. **Folderless by default.** On-demand scratch, `~/Documents/Instrument/` for deliverables, and agent-requested folder access with the in-chat permission prompt.
7. **The file tree.** Watcher-backed live browsing of the working folder, with a cap strategy for large trees.

Phases 1 through 3 are invisible to the user and are most of the work. That is the honest shape of this: the feature is a folder picker, the cost is a refactor of what a task directory means.

## Decisions taken

- **A working folder can belong to either a task or a project**, and connecting one at task level implicitly creates the project-level grouping. The user interface groups them the same way regardless of which route created it, and deduplicates. This makes the picker a once-per-folder act rather than a per-task tax, and it matches what both comparable products do without forcing the user to learn "projects" before they can point at a folder.
- **A project owns exactly one working folder, and any number of sources.** Both comparable products are visibly unsettled here, so start restrictive: one place the work happens, many places to read from. Keep the layout general (mounts already carry `readOnly`, and nothing should encode "exactly one writable mount" at the type level) so that relaxing this later is a product change rather than a rewrite.
- **`/mnt` stays a single read-only concept.** No writable variant, no second mount root that differs only by permission.
- **Concurrency is allowed**, per the reasoning above.
- **No `~/Instrument/`.** Output goes to `~/Documents/Instrument/`, scratch goes to application data.

## Open questions

- How does the change record handle bash? See change 4; this is the one open question that constrains what the product can honestly claim.
- Does a task connected to a folder but not to a project exist as a durable state, or does connecting always create the project grouping immediately? The second is simpler to explain and harder to undo.
- Does the artifact-presentation tool replace markdown links for grouped results, or sit alongside them? Two ways to show a file is tolerable; two ways with different capabilities is not.

## Why moving the workspace is unnecessary

The approach this supersedes solved "the user cannot find their files" by relocating our directory somewhere visible, taking the whole workspace root with it. This plan solves the same problem by not owning the directory the work lives in. Once that holds, the workspace goes back to being pure application data, which is a place nobody needs to browse, and the move loses its motivation.

What that line of work established still applies to `~/Documents/Instrument/` in phase 6, at a much smaller scale: the macOS consent mechanics recorded above, detecting when a target sits inside a cloud sync root, and the fact that relocating a root means auditing every path already stored against the old one.
