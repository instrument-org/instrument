# `git` reaches attached folders, and a read-only grant means read-only git

Date: 2026-09-11

Narrows the native-binary rule in [architecture/bash-sandbox-mounts-and-native-binaries.md](../architecture/bash-sandbox-mounts-and-native-binaries.md) for one more binary, the way `rg` already narrowed it.

## Context

Every native binary was refused a mount's host path, `git` included, and the refusal told the agent to copy the repository into the task first. Seven of 335 local tasks hit that refusal, six of them in the four days after the conversation started handing tasks folders under the user's home, and two of those were not developer work at all: weekly-review tasks running `git log --since` over the user's repositories to say what happened that week. Each one then paid for the copy: one `cp -R` aimed at a checkout with 2.6 GB of `node_modules` and seven thousand symlinks the mount refuses, ran three minutes, and was stopped at 1.6 GB; one set `GIT_DIR=` on a copied `.git`, which the isolation env drops silently, and gave up on that repository; one aborted on the first symlink and got there several turns later with `find -exec cp`. Nothing in the harness needed the copy. Git reads history out of `.git` and writes nothing for it.

The rule being narrowed protects two things: the user's folder from a binary that writes without the virtual filesystem's symlink check or private-dir mask, and the machine's layout from reaching a subprocess at all. What made a blanket refusal the right first answer for `python-native` and `ffmpeg` is that neither can be told which of its operations write. Git can: its subcommands sort cleanly into ones that read a repository and ones that change it.

## Options weighed

**Keep the refusal, say it right.** Copy `.git` alone for history, `checkout -- .` for a tree, never the folder. Ten minutes and no new reach. Rejected as the end state because it keeps a copy that serves nothing, and cannot work for a worktree, whose `.git` is a pointer to a repository somewhere else.

**Read-only git over mounts.** An allowlist of reading subcommands, `--no-optional-locks` forced, mount paths bridged the way `rg` bridges them, output mapped back. Enough for every task in the record. Rejected as the whole answer because a user who attaches a repository read and write will ask the agent to commit in it, and refusing that for a folder they granted is the kind of wall this product exists to remove.

**Git over mounts, gated by the grant.** Chosen. The same bridge, with the mount's access level deciding what git may do rather than whether it may look.

**A git inside the sandbox** (isomorphic-git as a just-bash command). Contained by construction, and it would refuse writes to a read-only mount with EROFS like every other builtin. Rejected for now: agents type git's command line, and a second git without `blame`, without `diff` porcelain, with partial `log` filters and no worktree support, under a name whose powers differ from the binary's, is the ambiguity the two-Pythons decision refused to ship. Revisit if the allowlist keeps growing.

**Reading `.git` from the sandboxed script runtimes.** `python` and `js-exec` can open a mount's `.git` in place, and a loose object is one `zlib.decompress`. Packfiles are a format to implement, a worktree's pointer lands outside the mount anyway, and a mechanism that has to be spelled out in the prompt to be found is not one. Rejected without building it.

## Decision

- `git` is handed a mount's host path, as a working directory (`cd /mnt/repo && git log`) and in arguments (`-C /mnt/repo`, `--git-dir=/mnt/repo/.git`), through the same resolution `rg` uses: the masked private dir is refused, a symlink out of the mount is refused, and host roots are mapped back to mount points in the output.
- In a read-only mount only the subcommands that write nothing run: `log`, `show`, `diff`, `blame`, `status`, `rev-parse`, the listing forms of `branch`, `tag`, `remote`, `stash`, `config --get`, and the rest of the set in `git.ts`. `--no-optional-locks` is forced so `status` and `diff` stop refreshing the index. Anything else is refused with a message that names the mount and says the folder has to be attached read and write.
- In a read-and-write mount git runs as it does in the task. That is the folder the user granted, and committing in it is what they granted it for.
- The argv and environment policy is unchanged: no credentials, http and https only, no config key that runs a program, no `-C` chain out of the task or out of every mount.

## What this does not close

A `.git` file inside the task, or inside a mount, can point git at a repository anywhere on the host, and git follows it. That is how a worktree attached as a folder reads its history, since its repository lives in the main checkout, and it is also a path out of the task that the argv checks do not see. Left open on purpose: the native `node` hatch already reads any host path a script names, so this is not a new class of reach, and closing it would make an attached worktree unreadable without a message the agent could act on. If the sandbox ever gets a real boundary for native binaries, `git rev-parse --absolute-git-dir --git-common-dir` before spawning is the check, and it is cheap.

## What would change it

A user attaching a repository they do not trust, a downloaded one whose `.git/config` they never read. The config denylist and the stripped `GIT_*` environment hold there as they do for a copy, and the copy path had the same exposure, so the change widens nothing; but that is the case to re-read this against.
