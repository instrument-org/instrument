# What the orchestrator can reach, and whether attachment is the right shape for it

**Status:** open question, researched 2026-09-08 against `spike/orchestrator`. Nothing here is built. The premise that started it — "the orchestrator cannot modify files, so it could safely read the whole disk" — is half true, and the half that is false is where the design turns. Recorded because the answer is not "yes" or "no" but "read and write have to come apart first", and that is a change to how a task's grant is derived rather than to how the shell is mounted.

## The question

The orchestrator reaches exactly two folders: the user's home folder and the workspace folder, both attached to its conversation at window open. Everything else needs `request_folder`. The intended model was different — the conversation understands the machine, and the boundary lives at the task, which is where code runs and files are written. So: could the attachment mechanism be dropped for the conversation, and replaced with ambient read of the whole filesystem?

## What is true today

**Attachment is the only path to visibility.** `tools/bash.ts` rebuilds the sandbox on every call from `taskState.attachedFolders`, and `buildWorkspaceFsLayout` turns each into a mount. Nothing attached means nothing visible. There is no ambient read anywhere in the agent's path.

**The two folders are the app's own doing, stamped as the user's.** `ensureHomeFolder` and `ensureOutputFolder` (`rpc/routes/orchestrator.ts`) attach them when the window opens. `FolderAttachment.Source` is only `"project" | "user"`, so they are recorded as `"user"` — and the conversation's context tells the model "The user has attached these folders to this conversation" about a home folder the user never attached. They also diff as arrivals in the note built for user grants, which is how this question surfaced.

**The conversation can already modify the filesystem.** The allowlist in `orchestratorRefusal` is `app cat chat cp file find head ls mkdir mv open stat tail task wc`, plus a filter after a pipe, plus a ban on redirecting output. `cp`, `mv`, and `mkdir` are on it deliberately: putting a finished file where it belongs is the conversation's job. So it cannot author a file's contents, but it can move one over another and destroy it. **What bounds that today is not the command list; it is the mount table.**

**The mount table is what makes writes safe, and it is doing two jobs.** A mount carries `readOnly` per folder. The home mount is recorded `read-write` and downgraded to read-only *as a whole* by `effectiveFolderAccess`, because the workspace lives inside it — and folders inside it keep the write grant. That one rule is doing two unrelated things: it stops the agent writing into the user's home, and it is also the thing that lets the conversation hand a task `Downloads:rw`.

**A task's grant is derived from the conversation's.** `resolveFolders` refuses `--folder X:rw` unless the conversation itself holds X as read-write. The invariant is `task ⊆ conversation ⊆ what the user granted`.

**The app already reads the whole disk — just not for the agent.** `lib/orchestrator/computer.ts` walks `/Volumes` and any host path with the app's own permissions, and computes an access label per folder from the grants. So the This Mac screen sees everything while the agent sees two mounts. Point at an external drive and say "this folder" and the conversation has to ask for it.

**The privacy delta is narrower than it sounds.** The home mount is readable in full, and nothing is masked: attached folders are mounted `masksPrivateDir: false`, and the workspace-overlap rule is a write rule rather than a read mask. `~/.ssh`, shell history, and application support directories are already readable by the conversation today. Ambient read would add `/Volumes`, `/Applications`, system directories, and other users' homes — real, but not the step from nothing to everything it reads like.

## What the change would actually be

**Read is trivially expressible.** A mount is `{ hostRoot, mountPoint, readOnly, masksPrivateDir }`, so `{ hostRoot: "/", readOnly: true }` needs no new machinery. The asset origin resolves through the same layout, so file previews follow automatically.

**Write is the whole decision.** Mount `/` read-only and two things break at once:

- `cp` and `mv` stop working outside the workspace folder. This is *not* a regression — measured on GLM 5.3 Flash, a `cp` into `/mnt/Home/Downloads` already fails `EROFS` today, because the home mount is read-only as a whole. So the conversation's write surface is already just the workspace folder, and a global read-only mount matches it.
- `--folder <anything>:rw` to a task gets refused everywhere, because `resolveFolders` requires the conversation to hold write. **This breaks the central flow**: handing a task a folder to write its results into. Under the current derivation, a conversation that holds only read can grant only read.

So ambient read is not a drop-in. It forces the grant rule to change from "a subset of what the conversation holds" to something else — and *that* is the security model decision, not the mounting.

## What cannot be built, whichever way this goes

macOS has no API to ask which folders the app may read without triggering the prompt. This is already recorded in the 2.0 plan's Open list, and it means the hoped-for "global picture of what the agent can reach, per the OS" cannot exist as a lookup. It can only ever be a record of what has been tried. Today the prompt is raised deliberately at `task new`, with a person present and a refusal that the conversation can explain; ambient read moves the first prompt to an arbitrary `ls` in the middle of a turn, where the failure is an `EPERM` the model has to make sense of alone.

A second cost worth pricing: a read-only `/` lets `find` and `rg` walk the entire disk. The measured runaway risk on this model is already 15 minutes and a million tokens on a bad turn; the search space would be the machine.

## Where this points

The coherent version of the intent is to stop deriving the two from each other:

- **The conversation reads globally**, through a system-sourced read-only root mount. Matches the intent, matches what This Mac already does, and closes the external-drive gap.
- **The conversation writes only in the workspace folder.** This is already true in practice, so nothing regresses.
- **The conversation may grant a task write access anywhere the user's account can write**, rather than only where it holds write itself. This is the actual change, and it is the one that matches "the user should not have to grant access unless the system restricts it or it would surprise them": the boundary moves to the task, where it was intended to be, and `request_folder` narrows to the cases the OS gates.

That also folds in the mislabel: the root mount is the app's own reach, so it wants a third `source` (`"system"`) rather than claiming the user attached it. Every consumer of `source` today tests `=== "project"` or `!== "project"`, with no exhaustive switch, so a third value is inert until each site opts in.

What stays unresolved and should be decided before any of it is built: whether an unbounded write grant to a task is acceptable on the strength of the conversation's judgment alone, given that the conversation is a small model on the free tier as often as not. Today a bad grant is bounded by what the user attached. Under the proposal it is bounded by the model.
