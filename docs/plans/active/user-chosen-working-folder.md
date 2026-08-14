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

## The six structural changes

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

The two differ in cardinality and lifetime, not just in access level. Sources are many, added and dropped freely, often per message, and read-only is correct for them. A working folder is one (or a small set owned by a project), chosen deliberately, stable for the life of the work, and it orients the agent. Modeling that as an item in the attachment list with a write toggle would make every reference attachment a decision about write access that nobody wanted to make.

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

**Browsing is polled, not watched.** A file tree over the working folder is a genuinely good affordance, and it does not need a watcher: the tree polls itself while it is on screen, which is what the file-list panel already does ([file-references-without-a-watcher.md](../completed/file-references-without-a-watcher.md)). The reason that scales here and a watcher does not is what each one's cost is proportional to. A poll costs what is expanded; a watcher costs the tree, and the tree is now one the user picked.

That points at lazy per-directory reads rather than the whole-tree index. [get-task-files.ts](../../../packages/workspace/src/lib/get-task-files.ts) ignores `node_modules`, `.venv`, and friends because a Python scientific stack alone runs past the index cap, and that ignore list was tuned for a directory whose shape we knew. Pointed at a monorepo, an ignore list is a guess about someone else's repository; expanding only what the user opened is not a guess at all, and it makes the cap a per-directory concern rather than a global one.

**Attribution comes from somewhere else.** "What did the agent change this turn" was never going to come from watching the directory, because a user edit and an agent edit are the same filesystem event. It has to come from the agent's own actions.

**We can attribute more than "tool calls" implies, because our bash is not a real shell.** just-bash executes against a virtual `IFileSystem` we supply, so every mutation a shell command makes goes through an interface we control. The mechanism already exists and is already in production: [skill-write-tracking-fs.ts](../../../packages/workspace/src/lib/skill-write-tracking-fs.ts) wraps a filesystem and records `writeFile`, `appendFile`, `mkdir`, `rm`, `mv`, `cp`, `link`, `symlink`, `chmod`, and `utimes` without changing behavior, and it is already mounted on `/skills` in [workspace-fs-layout.ts](../../../packages/workspace/src/lib/workspace-fs-layout.ts). Wrapping `/work` in the same tracker gives per-turn attribution across the file tools and the entire shell surface, for a small fraction of the cost of snapshot-and-diff.

The real gap is narrower than the whole shell: **real subprocesses.** `ffmpeg`, `python`, `node`, and `pnpm` run against the kernel through `resolveNativeHostPath` and never touch our virtual filesystem, so their writes are invisible to the tracker. That is a genuinely unsolvable case short of OS-level instrumentation, and it is the honest limit of what the change record can claim.

Recommended posture:

- Track the virtual filesystem, which covers file tools and shell built-ins. This is the primary record and it is cheap.
- Treat native-subprocess output as unattributed. Where a turn ran one, the record can say so rather than pretending completeness.
- Let the browsable tree be the backstop: it reads the directory, so it shows everything including what a subprocess wrote, and it attributes none of it. That is the honest division. A tree the user can look at answers "what is there" without ever claiming to answer "who put it there".

Neither mechanism alone is complete, and saying so in the interface is better than a change list that quietly omits what a build step did.

### 5. Folderless tasks: split scratch from output

With no folder connected, the agent has nowhere to work and nowhere to put results. These are two needs, not one, and conflating them is what made the previous version of this plan reach for a visible `~/Instrument/` that would fill up with `node_modules`.

- **Scratch** is where the agent works: builds, dependency installs, temp files, intermediate junk. Application data, invisible, disposable, created on demand. This is what `tasks/<id>/work/` is today, minus the assumption that it always exists.
- **Output** is where finished deliverables go when there is no user folder to put them in. Visible, browsable, and containing only files a person would want.

That split resolves the location question rather than trading it off, and it changes the answer (see [Where the visible output folder goes](#where-the-visible-output-folder-goes)).

Also: task creation stops materializing a directory tree. A conversation that never touches a file should produce no directory at all.

Note the ordering constraint: the private directory currently also holds `task.db`, so "no directory until needed" is only fully reachable once conversation data stops living in a per-task file. That is [conversation-storage.md](conversation-storage.md), and it is why the two plans are related but separable. Until it lands, a fileless task still creates its private directory, which is invisible and cheap.

### 6. The asset origin follows the layout, not the task directory

Serving files is the part of this plan that looks like it needs redesigning and mostly does not. The reason is worth stating before the changes, because it decides how much work this is: **the asset origin is already a task's virtual filesystem over HTTP, not a task's folder over HTTP.** [assets.ts](../../../packages/workspace/src/logic/server/routes/assets.ts) builds the same `WorkspaceFsLayout` the file tools and bash sandbox build and resolves the request through the same `resolveHostPath`. It already serves a mount that is nowhere near the task directory — `/mnt/Photos/cat.png` is a real, tested, symlink-contained asset URL today, and the agent prompt already teaches the model that an attached folder is reachable from agent-authored HTML by its absolute `/mnt/...` path *because* that is what the static origin resolves. See [asset-origin.md](../../architecture/asset-origin.md) for the full map of what exists.

So the answer to "can we already serve mounted files" is yes, and the answer to "does the subdomain approach still make sense" is also yes, for a reason that is easy to miss: **the subdomain identifies a layout, not a directory.** `assets.<taskId>` means "the set of mounts this task can see", which is exactly the thing that survives a task having no directory of its own. A folderless task still has a layout; it just has fewer mounts in it.

The alternative — keying the origin on the *folder* so two tasks sharing a working folder share an origin — should be rejected. Agent-authored HTML runs as a real origin, so a shared origin merges two tasks' `localStorage`, IndexedDB, and service workers. That is the same channel the artifact-preview work closed at the storage-partition level by giving each task its own profile directory; opening it back up at the origin level would undo that for no gain. The cost of keeping it per-task is that the same file opened from two tasks is two URLs with independent storage, which is correct rather than merely tolerable.

What actually has to change is four things.

**The root rewrite generalizes to a reserved-prefix rule.** Today the route maps `/` to the task mount and carves `/mnt` out of it. Under the new layout there are two more roots (`/work`, `/scratch`) and the same question for each. Keep the shape: **the origin root is the working mount, and every other mount keeps its virtual path as a reserved prefix.** Root-relative references inside agent HTML (`<link href="/style.css">`) keep working, every stored transcript path keeps resolving, and `getAssetUrl` stays the single virtual-path-to-URL mapper with `assets.ts` as its inverse. The pair to keep in step gains a third member: `assetPathForVirtualPath` in [agent-browser-asset-url.ts](../../../packages/workspace/src/lib/shell-commands/agent-browser-asset-url.ts) performs the same translation for the agent's browser and must learn the same roots, or the agent and the human stop loading the same URL.

The hazard this brings forward is real and currently theoretical: a reserved prefix shadows a real directory of the same name. Today a task containing `mnt/` would be unreachable there, and nobody has hit it because we own the directory and never make one. A folder the user picked is a different proposition — `scratch/` is an ordinary directory name in a real repository. Options are to accept and document the shadowing (longest mount wins, which is at least consistent with the bash sandbox), or to make the reserved roots collision-proof. Do not solve it by renaming `/mnt`: that string is in the agent prompt, in stored `MountedWorkspacePath` values inside message parts, and in the file tools' path grammar.

**Cache policy must key on ownership, not on "is it a mount."** The rule today is `!isMountedFile && versionMatches` for a year of `immutable`, with everything else `no-store`. That reads as "task files are ours, mounts are theirs", and the folder plan breaks the equation: `/work` may be a directory the user edits in another application while the task is closed and nothing of ours is looking at it. Restate it as **immutable only for mounts we own** — `/scratch`, and `/work` when it is backed by a private directory — and `no-store` for anything user-owned, which is what `/mnt` already gets. One condition, and it avoids serving a year-stale artifact from a folder that changed under us.

**Existence stops being guaranteed.** `taskDir(id)` is a pure join and the route calls it unconditionally, then reads `state.json` beside it. A task that never materializes a directory (change 5) has neither. The route needs to tolerate a layout with no working mount and answer 404 rather than throw, and `buildWorkspaceFsLayout` needs to be able to express that absence rather than requiring a `TaskDir`. This is small but it is on the critical path: it is the same signature change as the `WorkingDir` brand in change 1.

**Agent-facing byproducts have to stay servable, and some of them are not scratch.** `getScreenshotsDir`, `getTaskTmpDir`, and the tool-output spill logs live under `work/` today specifically so the agent can read back paths it is handed — and screenshots in particular are read back through this origin. Moving them to `/scratch` means `/scratch` becomes a served root, which it is not today under any name. Whatever the scratch layout ends up being, the constraint is that the private dir must not be inside it: today the route protects `task.db` with an explicit `.instrument` deny rule, and a scratch directory that structurally cannot contain the private dir retires that rule instead of duplicating it for a second root.

But scratch is the wrong home for half of that list. A generated image or a screenshot the transcript renders belongs to the **conversation**, and scratch is disposable by definition — a six-month-old transcript still has to render its images. That is a category we have never had to name because the task directory absorbed it, and it is planned in [conversation-storage.md](conversation-storage.md#conversation-scoped-assets). For this plan the consequence is a fourth root on the origin, one that is neither the user's folder nor a mount the agent has today.

Whatever the roots end up being, the invariant to hold is the one that makes any of this safe: **the origin serves exactly what the agent can read, at the agent's own paths, and never more.** Attaching a folder is the grant; the origin inherits it rather than having a policy of its own, so there is no second consent to reason about and no way for the served set to drift wider than the mounted set. Read-only, and narrower than the agent where it can be, is fine; wider is a bug by construction.

**The task id stops being able to do all of its jobs.** It is currently the primary key, the folder name, this origin's DNS label, and the human-readable title at once — a prompt-derived slug from [generate-task-folder-name.ts](../../../packages/workspace/src/lib/generate-task-folder-name.ts). Every one of those jobs pulls a different way here: the origin wants it unguessable, the folder name stops existing, and a title the user can rename cannot be a key. Splitting it into a generated id plus a stored title is phase 0 of [conversation-storage.md](conversation-storage.md#phases) and a prerequisite for this work too.

#### The security consequence, which is the part that is not mechanical

The asset origin is unauthenticated, wildcard-CORS, on a fixed port, keyed by a human-readable task id derived from the user's first prompt. Any local process, and any web page that can reach loopback, can read a task's files today by guessing an id. That is bounded now because what it reads is our scratch plus folders the user explicitly attached. Pointing the origin's root at a folder the user picked removes the bound: the same request reads a source repository's `.env`, or a documents directory.

Compounding it, agent-authored HTML runs on this origin as a *real* origin under the guest-pool work, which makes `fetch("/.env")` same-origin and CORS-irrelevant, executed at a moment when no agent is running and no one is watching. Neither plan causes this alone.

Full shape and the ranked fixes are in [asset-origin-is-open-to-any-local-reader](../../findings/asset-origin-is-open-to-any-local-reader.md). The short version, and the position this plan takes: **an unguessable per-boot label in the origin (`assets.<token>.<taskId>`) plus a non-wildcard CORS origin are prerequisites for pointing `/work` at a user's folder**, not follow-ups. Both are small and confined to `buildAssetBaseUrl` / `uriDetailsForHost` / the route's middleware, and both are cheap now and expensive to retrofit once artifacts are shareable.

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

### What was chosen, and on what evidence

A fenced block with `files` as its info string and one path per line. The full comparison and the measured results are in [presentation-syntax.md](presentation-syntax.md); the two findings that decided it:

- **Every fence a model emitted was well formed** — bare paths, one per line, one fence per reply — across two models and three prompt revisions. The syntax is not what models get wrong.
- **What they get wrong is when to reach for it**, and only wording fixes that. Neither model showed a file it had merely _found_ until the rule was stated as "any reply that names a file ends with the fence, a one-line answer included."

The link in prose is untouched and remains how a single file is mentioned. Directives lost on cost rather than on capability: remark parses a fence already, so the fence needs no plugin, no grammar of ours, and no hand-written mid-stream handling.

Coordinate the streaming behavior with [incremental-live-transcript-updates.md](incremental-live-transcript-updates.md).

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
- **Symlink containment gets stricter than a real repository expects.** `hostPathEscapesMount` fails a path whose realpath leaves its own mount, and both the asset route and `resolveReadOnlyHostPath` depend on it. Inside a directory we created that is invisible; inside a checkout the user picked it is not, because a pnpm `node_modules` is a tree of links into a store outside the folder. Serving those over the asset origin is nobody's use case, but the same check gates grep and the read-only native bridge, so decide deliberately whether a working mount trusts links that leave it.
- **The asset origin's reach**, covered in [change 6](#6-the-asset-origin-follows-the-layout-not-the-task-directory). Two blocking prerequisites, not follow-ups.

## What does not change

- The database, session state, and browser session stay in application data. No SQLite in synced folders, no `node_modules` in the documents directory, no TCC prompt at boot.
- No data migration. Existing tasks keep their current directory as their working directory; the new path applies to new tasks.
- The `/skills` mount, unchanged. `/mnt` keeps its read-only semantics with no exceptions; what changes is that a writable root exists elsewhere.
- The explicit file-link mechanism. Markdown links already render as preview chips; that path is extended, not replaced.
- Conversation storage. Per-task databases stay as they are until [conversation-storage.md](conversation-storage.md) is scheduled on its own.

## Phases

1. **Split the concept.** Introduce the `WorkingDir` brand, make the working directory stored rather than derived, and set it to today's task dir for every task. No behavior change, no UI. This is the refactor that makes the rest small.
2. **Mount rename and the bridge rule.** `/work` and `/scratch` replace `/task`; the layout supports a second writable mount; `resolveNativeHostPath` bridges writable mounts and keeps quarantining read-only ones; `TMPDIR` moves to `/scratch`; tests pin both halves. The asset origin moves with them in the same phase, not after: the route, `getAssetUrl`, and `assetPathForVirtualPath` are three renderings of one mapping, and letting them drift is how the agent and the human stop loading the same URL.
3. **Presentation.** Extend the existing link mechanism to folders and file sets, add the artifact-panel tool, and delete the automatic `output/` preview rule. Independent of the folder work and shippable on its own.
4. **Safety.** Write containment, the change record, restore story. Depends on the bash-attribution decision. The asset origin's unguessable label and non-wildcard CORS belong here, and gate phase 5 rather than following it.
5. **The picker.** Folder connection, recent folders, project grouping, persistence.
6. **Folderless by default.** On-demand scratch, `~/Documents/Instrument/` for deliverables, and agent-requested folder access with the in-chat permission prompt.
7. **The file tree.** Browsing the working folder as an expandable tree, with lazy per-directory reads and a poll while it is on screen. Attached folders expand in it too, so one tree answers "what can I open" regardless of which mount a file sits on.

   **Separable from the six phases above, and the only one that is.** Most of it already exists: [task-files.tsx](../../../apps/studio/src/client/components/task/task-files.tsx) builds an expandable tree, polls itself while open, and already lists attached folders. What is missing is expanding an attached folder's *contents* rather than naming it as a row, and reading a directory when it is opened rather than walking the whole task up front. Neither waits on the working-folder concept: they are improvements to a surface that ships today, and doing them first is what makes this phase small when the rest arrives.

Phases 1 through 3 are invisible to the user and are most of the work. That is the honest shape of this: the feature is a folder picker, the cost is a refactor of what a task directory means.

## Decisions taken

- **A working folder can belong to either a task or a project**, and connecting one at task level implicitly creates the project-level grouping. The user interface groups them the same way regardless of which route created it, and deduplicates. This makes the picker a once-per-folder act rather than a per-task tax, and it matches what both comparable products do without forcing the user to learn "projects" before they can point at a folder.
- **A project owns exactly one working folder, and any number of sources.** Both comparable products are visibly unsettled here, so start restrictive: one place the work happens, many places to read from. Keep the layout general (mounts already carry `readOnly`, and nothing should encode "exactly one writable mount" at the type level) so that relaxing this later is a product change rather than a rewrite.
- **`/mnt` stays a single read-only concept.** No writable variant, no second mount root that differs only by permission.
- **Concurrency is allowed**, per the reasoning above.
- **No `~/Instrument/`.** Output goes to `~/Documents/Instrument/`, scratch goes to application data.
- **The asset origin stays per task.** It identifies a layout, not a directory, so it survives a task owning no directory; keying it on the folder instead would merge two tasks' web storage for agent-authored HTML.

## Open questions

- How does the change record handle bash? See change 4; this is the one open question that constrains what the product can honestly claim.
- Does a task connected to a folder but not to a project exist as a durable state, or does connecting always create the project grouping immediately? The second is simpler to explain and harder to undo.
- Does the artifact-presentation tool replace markdown links for grouped results, or sit alongside them? Two ways to show a file is tolerable; two ways with different capabilities is not.
- When a reserved URL prefix collides with a real directory in the user's folder, does the mount win silently or does the collision get surfaced? Silent shadowing is consistent with the bash sandbox and invisible to the person whose `scratch/` stopped loading.
- Does a working mount trust symlinks that leave it? A checkout the user picked routinely contains them; a directory we created never did.

## Why moving the workspace is unnecessary

The approach this supersedes solved "the user cannot find their files" by relocating our directory somewhere visible, taking the whole workspace root with it. This plan solves the same problem by not owning the directory the work lives in. Once that holds, the workspace goes back to being pure application data, which is a place nobody needs to browse, and the move loses its motivation.

What that line of work established still applies to `~/Documents/Instrument/` in phase 6, at a much smaller scale: the macOS consent mechanics recorded above, detecting when a target sits inside a cloud sync root, and the fact that relocating a root means auditing every path already stored against the old one.
