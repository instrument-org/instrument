# Carry just-bash's error-code fix as a local patch rather than rewrite the builtins' output

Date: 2026-10-11

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

Since [the agent works at real paths](2026-10-11-the-agent-works-at-real-paths.md), the Permissions rules refuse reads inside the folders it reaches, and the boundary refuses folders outside every mount. Both throw `EACCES`. just-bash's builtins ignore the code: `cat`, `head`, `ls`, `wc` and the rest print `No such file or directory` for any failed read. A model told a folder is missing gives up on it rather than waiting on the card the refusal raised.

## Options weighed

**Rewrite the line downstream.** Shipped first: `bash.exec` in `create-bash-env.ts` collected each path the rules refused during a call and replaced `<path>: No such file or directory` with `Permission denied` in stderr. Rejected: it matched output text, so it depended on every builtin's exact phrasing and quoting, needed a second argument on `onRefusal` that existed only for it, and could only correct the paths it heard about.

**Patch the published bundle.** Chosen. The fix is upstream as [vercel-labs/just-bash#570](https://github.com/vercel-labs/just-bash/pull/570): one helper maps a failed operation's errno to strerror's text, falling back to `No such file or directory` for `ENOENT` and anything without a known code, and the reading builtins print it. It conflicts with #449's `ls` builder on 3.6.0, so it is carried as a three-way port, `error-codes-3.6.0.diff`, which also moves #449's `ls -R` test to `Permission denied`.

The base filesystem under the mounts threw `ENOENT` for a folder outside every mount even when it exists on disk; it now throws `EACCES` for one it reports as refused, so that case reads the same as a rules refusal without the rewrite.

## Decision

Carry the thirteenth part of `patches/just-bash@3.6.0.patch`, ported from #570, until it is in a version we install, and delete the downstream rewrite. The refusal notes the shell appends to stderr stay, since an error from a script worker still loses its path to the sanitizer. `create-bash-env-permission-denied.test.ts` is the guard, run on this thread and in the bash worker.
