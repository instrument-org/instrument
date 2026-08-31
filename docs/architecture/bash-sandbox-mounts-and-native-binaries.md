# Bash sandbox: the mount layout and the native-binary boundary

## The layout

`packages/workspace/src/lib/workspace-fs-layout.ts` is the single source of truth for what the agent can see. Its consumers build from it and must never disagree: the just-bash virtual filesystem, the dedicated file tools (`read_file`/`write_file`/`edit_file`/`generate_image`), the `rg` shell command, the native-binary path bridge, and the asset origin route ([asset-origin.md](asset-origin.md)).

- `/task` — the task directory, writable, the shell's working directory. Relative paths and `/task/...` resolve to the same place in every tool. Its `.instrument` private dir is masked from the agent's view (`maskPrivateDirFs`); see [the finding on what that mask is and is not](../findings/private-dir-masking-is-not-a-boundary.md).
- `/skills` — the workspace's own `skills/` dir, writable, created rather than skipped when absent so the agent never writes into a mount the prompt advertises but that does not exist, and wrapped in `skillWriteTrackingFs` so skill edits are attributed.
- `/project` — the folder of the task's project when it has one, writable, with `.instrument` masked; skipped when the directory is gone. See [agent-sandbox.md](agent-sandbox.md) for why it is singular and what the mask protects.
- `/dev` — a small in-memory stub (`null`, `zero`, `stdin`, `stdout`, `stderr` as plain writable files, rebuilt per call) so `cmd > /dev/null` resolves instead of dying with EROFS and taking the whole call's output with it.
- `/mnt/<name>` — user-attached folders, one directory per folder, each read-only or read-write according to the access the user granted it. A read-only folder mounts through `OverlayFs` with `readOnly`; a writable one mounts through `ReadWriteFs`, the same filesystem the task mount uses, because `OverlayFs` is copy-on-write **into memory** and the filesystem is rebuilt per bash call — mounting a writable folder there would report every `mv` and `cp` as succeeding and leave the user's files untouched. Write access is refused outright, whatever the user granted, for a folder that contains or sits inside the workspace root (`effectiveFolderAccess`): otherwise one task's grant would reach every other task's database and the skills the agent loads as instructions.
- Everything else — an empty **read-only** base filesystem (`read-only-base-fs.ts`). Writes outside the mounts (e.g. `/tmp/x`) fail with EROFS and guidance. Before this, the base was a writable per-call in-memory FS, so such writes _succeeded and silently evaporated_ when the bash call ended — a miserable failure mode to debug.

Mount names are unique per task: every `attachedFolders` writer re-derives the whole set through `assignMountNames` (`lib/assign-mount-names.ts`) and the record is keyed by name, which is what makes a folder's mount path derivable from its name alone anywhere it is displayed. The `(n)` suffix in `assignAttachedMounts` is a backstop for corrupted state, not a feature.

## The boundary: two worlds

Everything that runs **in our own Node process** sees virtual paths, because we intercept every I/O call: the file tools, just-bash builtins (`cat`, `grep`, redirects, ...), and tools like `generate_image` that read files themselves.

**Real subprocesses** (`python`, `node`/`tsx`, `ffmpeg`, `ffprobe`, `pnpm`, `agent-browser`) do their own syscalls against the real kernel filesystem. (`curl` is not among them: it is a just-bash network builtin and never touches the kernel filesystem.) We can only rewrite their **argv**: `resolveNativeHostPath` bridges `/task/...` arguments to the real task dir and quarantines every other virtual path to a nonexistent path _inside_ the task dir, so the binary fails with not-found instead of touching the host. This is deliberate, and it holds for writable mounts too: a real host path is read *and* write to the operating system, so handing one to a subprocess would put the user's folder outside every containment the sandbox has — no symlink check, no path masking, no way to tell what a build step touched. The agent copies a file into the task and works on the copy; writes back into the folder go through the virtual filesystem. Do not "fix" the bridge by resolving against the full layout.

The exception is `rg`, which resolves mounts through `resolveReadOnlyHostPath` so a search can reach attached folders. It earns that by refusing every flag that lets ripgrep run another program (`--pre`, `--pre-glob`, `--hostname-bin`, `-z`), re-checking symlink containment, and mapping host roots back to mount points in its output. It also shadows just-bash's own `rg` reimplementation — registered after the bundled commands so the real binary wins, being orders of magnitude faster on a large tree and free of the builtin's `(?i)` and root-level-glob bugs.

**Device paths cross the bridge unchanged** (`resolveHostDevicePath`): `/dev/null`, `/dev/zero`, `/dev/random`, `/dev/urandom`, and the three standard streams, by exact name so `/dev/disk0` and `/dev/fd/<n>` stay quarantined. These are host character devices rather than virtual paths, and quarantining them protected nothing — they hold no user data, name no part of the machine's layout, and inline code and script files, neither of which is rewritten, already reach them. What it cost was the standard idiom: `ffmpeg -pass 1 -f mp4 /dev/null` failed with a not-found error naming `./dev/null`, a relative path the agent never wrote, because `redactTaskDir` strips the task-dir prefix off the quarantined path on the way back. On Windows only `/dev/null` maps, to `\\.\NUL`.

**A quarantined path is explained rather than left to the binary** (`unreachablePathArgError`, used by `ffmpeg`, `ffprobe`, `python`, `pip`, `uv`; `git` carries its own longer message). The shim answers before spawning, naming the mount or path the agent actually asked for. Without it the agent reads the binary's not-found error for the quarantined path, which reads like a relative-path mistake it made rather than the boundary it is.

Consequences to remember:

- **Inline code is bridged; script files are not.** Quoted `/task/...` string literals in inline program text (`node -e`, `tsx -e`, `python -c`, and heredoc programs piped to python) are rewritten to cwd-relative paths by `bridgeInlineCodePaths` (`shell-commands/utils.ts`) — relative, not absolute, so the host dir never appears in the code and Windows backslashes never corrupt string escapes; the quote prefix keeps JS regex literals like `split(/task/)` untouched. Quoted `/mnt/...` literals fail fast with copy-first guidance. Paths inside script FILES on disk are never translated: `python work/script.py` works because the script path is argv, but `open("/task/work/x")` inside that file resolves against the real root and fails. The subprocess cwd is the real task dir, so task-relative paths in script code always work. The bash tool description teaches this.
- **Processing an attached file requires copying it into the task first.** `ffprobe /mnt/Photos/clip.mov` is refused with copy-first guidance naming the mount; the agent prompt teaches `cp '/mnt/<folder>/file' attachments/` first.
- **Stdin crosses as bytes, not a string.** just-bash packs stream data one byte per char (latin1); `subprocessStdin` converts that to a `Buffer` before it reaches `execa`, whose string `input` would UTF-8 re-encode it and mojibake every non-ASCII byte of a heredoc or piped binary.

## Why we didn't unify the two worlds

Each alternative for giving real subprocesses the virtual view was rejected:

- **macFUSE / NFS-style mount**: requires a kernel/system extension install — unacceptable UX for a consumer desktop app.
- **Symlink farm** (`taskDir/mnt/<name>` → real folder): symlinks don't carry read-only permissions, so any native binary could write through one into the user's real folder. Breaks the core invariant.
- **Copy-on-read materialization**: magic, surprising, and unbounded for large media. The explicit copy-first rule is predictable and already taught.

## just-bash quirks we compensate for downstream

just-bash is the published npm package (`just-bash@^3.4.1` in `packages/workspace/package.json`), consumed unmodified: no local patches, no fork build. Fixing a quirk here means landing it upstream and waiting for a release, which is why each one below is absorbed downstream instead. See [just-bash-upstream.md](just-bash-upstream.md) for what we consume and what is open upstream, and [the decision to carry no local patches](../decisions/2026-08-27-no-local-just-bash-patches.md) for why patching the published bundle is not the answer. Known quirks:

- A **redirect into a read-only mount throws** (`echo x > /mnt/<read-only folder>/...`) instead of producing stderr + exit code. `tools/bash.ts` and `scripts/run-bash.ts` convert the thrown error into a normal failed-command result.
- **`mv` out of a read-only mount half-completes**: cross-mount `mv` is copy-then-rm, the copy lands in the task, the `rm` fails with EROFS, an error is reported, and the source is preserved. Benign direction, confusing error.
- **OverlayFs EROFS messages print mount-relative paths** (`'/new.txt'` for `/mnt/Docs/new.txt`).
- `MountableFs` synthesizes mount points for `ls /`, `stat`, etc.; its routing table is private, which is why `workspace-fs-layout.ts` mirrors the longest-prefix arithmetic instead of reusing it.
- just-bash ships no **`mktemp`**; ours (`shell-commands/mktemp.ts`) targets the task-local `work/tmp`, and is offered upstream (see [just-bash-upstream.md](just-bash-upstream.md)).

## Symlink policy differs by layer (intentionally)

- **just-bash mounts** refuse to traverse _any_ symlink, inside or out.
- **The file tools** go through real `node:fs`, so they enforce containment with a realpath check (`hostPathEscapesMount`): symlinks that stay inside the mount work, escapes are rejected. This is check-then-read; a race between the check and the read is theoretically possible, but the adversary would be a process on the user's own machine racing their own agent — out of scope for the local threat model.

## Testing without booting Studio

`cd packages/workspace && pnpm --silent script:run-bash -- --attach <dir> "ls /mnt"` boots the exact runtime sandbox (see `.agents/skills/run-bash/SKILL.md`). The invariants are pinned by `workspace-fs-layout.test.ts` (mount semantics, EROFS, missing-mount skip), `resolve-agent-path.test.ts` (virtual path resolution, steering, write policy), and `shell-commands/utils.test.ts` (native quarantine).
