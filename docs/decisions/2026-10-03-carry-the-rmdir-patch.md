# Carry just-bash's `rmdir` fix as a local patch rather than subclass `ReadWriteFs`

Date: 2026-10-03

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

On 3.4.1, `rmdir` and `find -delete` failed on every writable mount (`/task`, a writable `/mnt`, `/apps`, `/skills/workspace`) with `ERR_FS_EISDIR`. Both call `fs.rm(path, { recursive: false })`, and `ReadWriteFs.rm` hands that to Node's `fs.promises.rm`, which refuses every directory without `recursive`, empty or not. `InMemoryFs` and `OverlayFs` allow it, so upstream's tests never saw it.

## Options weighed

**Subclass `ReadWriteFs` downstream.** Shipped first, as `ReadWriteFsWithRmdir` mounted in place of `ReadWriteFs` by `buildBashFs`. Rejected on review: it was a second filesystem class to maintain for one call, it re-derived path containment and symlink handling `ReadWriteFs` already does, and its mount-root guard duplicated `MountableFs`, which already refuses to remove a mount point with `EBUSY`. The 2026-08-27 objection to patches, hand-editing minified output, no longer applies since the patch is rebuilt from source.

**Patch the published bundle.** Chosen. The fix is upstream as [vercel-labs/just-bash#527](https://github.com/vercel-labs/just-bash/pull/527): a non-recursive `rm` of a directory goes through `fs.promises.rmdir` after the existing symlink and path checks, and `EEXIST` maps to `ENOTEMPTY`. It is ten lines against `ReadWriteFs.rm` and applies to the 3.4.1 tag unchanged.

## Decision

Carry the tenth part of `patches/just-bash@3.4.1.patch`, pinned to #527, until it is in a version we install. `create-bash-env-rmdir.test.ts` is the guard, including the case that an empty attached folder's own directory survives `rmdir /mnt/<name>`.
