# EPERM on a symlink reads as a macOS denial

**Status:** resolved 2026-09-10. Recorded 2026-09-10 against `just-bash@3.4.1`. The refusal is deliberate and correct; the collision with our own prompt was not. The abort was a bug in upstream's cross-mount copy, fixed there as vercel-labs/just-bash#422 and carried as the third part of `patches/just-bash@3.4.1.patch` until it ships (see `docs/decisions/2026-09-10-carry-the-cross-mount-copy-patch.md`): the copy finishes around every link and reports them once at the end, `cp: cannot copy '/mnt/Docs': copied all but 2 entries: /mnt/Docs/link.txt: EPERM: operation not permitted, symlink '/work/copy/link.txt'; ...`, exit 1, guarded by `create-bash-env-cp.test.ts`. The prompt's EPERM rule now covers reading and listing rather than every EPERM under a mount, which is what severs the collision, since the destination's refusal still carries the errno. A `cp` symlink policy (`-L`) is not built: a read-only mount does not read through a link at all, so there is nothing for `-L` to dereference into. The in-task case (`cp -R` of a tree the task made, `node_modules` say) is a different path and a different message, `EACCES ... contains a symlink`, and still refuses the whole tree; see `just-bash-upstream.md`.

`cp -R` of any attached folder that contains a symlink fails on the first one, and the error it produces is the exact string the attached-folders prompt trains the agent to read as "macOS refused us the folder, stop and tell the user to open System Settings."

## What happens

A task attached a home-directory folder read-only and tried to copy it into the task so a real interpreter could parse it:

```plaintext
$ cp -R /mnt/.claude work/claude-data
cp: cannot copy '/mnt/.claude': EPERM: operation not permitted, symlink '/work/claude-data/CLAUDE.md'
```

Two of that folder's entries were symlinks. `cp` aborted the whole recursive copy on the first one.

## Where the refusal comes from

just-bash's `ReadWriteFs` takes `allowSymlinks`, which defaults to false:

> Whether to allow following and creating symlinks. When false (default), any path traversing a symlink is rejected and `symlink()` throws EPERM.

We never pass it, so we take the default. That is the right default and we should keep it: a symlink created inside the task could point anywhere on the host, and the mount layer's containment is built on the assumption that it cannot. The refusal is the sandbox working.

## Why it still costs us

**The message collides with our own guidance.** `build-attached-folders-text.ts` puts this in every session that has an attached folder:

> `EPERM` or "Operation not permitted" inside one of these means macOS refused Instrument the folder when it asked the user. Stop and say so rather than trying again; they can allow Instrument under System Settings, Privacy & Security, Files and Folders.

So the prompt tells the agent that this specific string means a permission dialog was declined, and to stop. An agent that follows the instruction abandons a task that is not blocked and sends the user to a settings pane that will not help. The agent in the observed run ignored the instruction and retried selectively, which is how it recovered.

**One symlink kills the whole copy.** `cp -R` has no skip-or-dereference fallback, so a single link anywhere in a large tree aborts everything already in flight. Nothing partial is reported.

## What would fix it

Independent, in rough order of value:

- Word the sandbox's symlink refusal so it cannot be mistaken for the macOS one: name the symlink as the reason and say the copy can proceed without it. The message already carries the link path; what it lacks is the sentence saying this is the sandbox's rule rather than the OS's.
- Give `cp` a symlink policy. GNU `cp` already has the vocabulary (`-L` to dereference, `--no-dereference` to skip), and dereferencing into the task is both safe and usually what the agent wants.
- Narrow the prompt's EPERM rule so it describes only the case it is about. It currently claims every EPERM under a mount is a macOS denial, and that is not true.

Related: the copy in the observed run existed only because a real interpreter cannot resolve a `/mnt` path at all. If a sandboxed runtime can read mounts directly, most recursive copies of attached folders stop happening and this stops being reachable for the common case. That is tracked separately.
