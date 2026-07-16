# Bash sandbox: the mount layout and the native-binary boundary

**Status:** current as of the attached-folder mounts work (PR #37; the
connectors branch adds a writable `/connectors` mount under the same rules)
plus the inline-code path bridge and byte-clean subprocess stdin.
Last updated 2026-07-16.

## The layout

`packages/workspace/src/lib/workspace-fs-layout.ts` is the single source of
truth for what the agent can see. Three consumers build from it and must never
disagree: the just-bash virtual filesystem, the dedicated file tools
(`read_file`/`glob`/`grep`/`write_file`/`edit_file`/`generate_image`), and the
native-binary path bridge.

- `/task` — the task directory, writable, the shell's working directory.
  Relative paths and `/task/...` resolve to the same place in every tool.
- `/mnt/<name>` — user-attached folders, read-only, one directory per folder.
- Everything else — an empty **read-only** base filesystem
  (`read-only-base-fs.ts`). Writes outside the mounts (e.g. `/tmp/x`) fail
  with EROFS and guidance. Before this, the base was a writable per-call
  in-memory FS, so such writes _succeeded and silently evaporated_ when the
  bash call ended — a miserable failure mode to debug.

Mount names are unique per task: every `attachedFolders` writer routes new
names through `uniqueFolderName` and the record is keyed by name, which is what
makes a folder's mount path derivable from its name alone anywhere it is
displayed. The `(n)` suffix in `assignAttachedMounts` is a backstop for
corrupted state, not a feature.

## The boundary: two worlds

Everything that runs **in our own Node process** sees virtual paths, because we
intercept every I/O call: the file tools, just-bash builtins (`cat`, `grep`,
redirects, ...), and tools like `generate_image` that read files themselves.

**Real subprocesses** (`python`, `node`/`tsx`, `ffmpeg`, `ffprobe`, `pnpm`,
`curl`) do their own syscalls against the real kernel filesystem. We can only
rewrite their **argv**: `resolveNativeHostPath` bridges `/task/...` arguments
to the real task dir and quarantines every other virtual path to a nonexistent
path _inside_ the task dir, so the binary fails with not-found instead of
touching the host. This is deliberate — a read-only mount's real host path must
never reach a process that could write through it. Do not "fix" the bridge by
resolving against the full layout.

Consequences to remember:

- **Inline code is bridged; script files are not.** Quoted `/task/...` string
  literals in inline program text (`node -e`, `tsx -e`, `python -c`, and
  heredoc programs piped to python) are rewritten to cwd-relative paths by
  `bridgeInlineCodePaths` (`shell-commands/utils.ts`) — relative, not
  absolute, so the host dir never appears in the code and Windows backslashes
  never corrupt string escapes; the quote prefix keeps JS regex literals like
  `split(/task/)` untouched. Quoted `/mnt/...` literals fail fast with
  copy-first guidance. Paths inside script FILES on disk are never
  translated: `python work/script.py` works because the script path is argv,
  but `open("/task/work/x")` inside that file resolves against the real root
  and fails. The subprocess cwd is the real task dir, so task-relative paths
  in script code always work. The bash tool description teaches this.
- **Processing an attached file requires copying it into the task first.**
  `ffprobe /mnt/Photos/clip.mov` fails with not-found (quarantined); the agent
  prompt teaches `cp '/mnt/<folder>/file' attachments/` first.
- **Stdin crosses as bytes, not a string.** just-bash packs stream data one
  byte per char (latin1); `subprocessStdin` converts that to a `Buffer` before
  it reaches `execa`, whose string `input` would UTF-8 re-encode it and
  mojibake every non-ASCII byte of a heredoc or piped binary.

## Why we didn't unify the two worlds

Each alternative for giving real subprocesses the virtual view was rejected:

- **macFUSE / NFS-style mount**: requires a kernel/system extension install —
  unacceptable UX for a consumer desktop app.
- **Symlink farm** (`taskDir/mnt/<name>` → real folder): symlinks don't carry
  read-only permissions, so any native binary could write through one into the
  user's real folder. Breaks the core invariant.
- **Copy-on-read materialization**: magic, surprising, and unbounded for large
  media. The explicit copy-first rule is predictable and already taught.

## just-bash quirks (fork fix candidates)

just-bash is consumed from the `mutewinter/just-bash` fork as a built-`dist`
git tarball, so changes mean editing the fork, rebuilding, and bumping the
pinned SHA. Known quirks we currently compensate for downstream:

- A **redirect into a read-only mount throws** (`echo x > /mnt/...`) instead of
  producing stderr + exit code. `tools/bash.ts` and `scripts/run-bash.ts`
  convert the thrown error into a normal failed-command result.
- **`mv` out of a read-only mount half-completes**: cross-mount `mv` is
  copy-then-rm, the copy lands in the task, the `rm` fails with EROFS, an error
  is reported, and the source is preserved. Benign direction, confusing error.
- **OverlayFs EROFS messages print mount-relative paths** (`'/new.txt'` for
  `/mnt/Docs/new.txt`).
- `MountableFs` synthesizes mount points for `ls /`, `stat`, etc.; its routing
  table is private, which is why `workspace-fs-layout.ts` mirrors the
  longest-prefix arithmetic instead of reusing it.

## Symlink policy differs by layer (intentionally)

- **just-bash mounts** refuse to traverse _any_ symlink, inside or out.
- **The file tools** go through real `node:fs`, so they enforce containment
  with a realpath check (`escapesMountRoot`): symlinks that stay inside the
  mount work, escapes are rejected. This is check-then-read; a race between
  the check and the read is theoretically possible, but the adversary would be
  a process on the user's own machine racing their own agent — out of scope
  for the local threat model.

## Testing without booting Studio

`pnpm --silent script:run-bash -- --attach <dir> "ls /mnt"` boots the exact
runtime sandbox (see `.agents/skills/run-bash/SKILL.md`). The invariants are
pinned by `workspace-fs-layout.test.ts` (mount semantics, EROFS, missing-mount
skip), `resolve-agent-path.test.ts` (virtual path resolution, steering,
write policy), and `shell-commands/utils.test.ts` (native quarantine).
