# Carry just-bash's option to fail a redirect into a missing folder as a local patch

Date: 2026-10-14

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

`echo x >> "Support/Instrument"` made `Support/` in the work folder and exited 0, where bash fails with `No such file or directory`. The folder came from just-bash, not from our filesystem layer: a redirect opens its target with the filesystem's `writeFile` or `appendFile`, and `ReadWriteFs` makes the missing parents first (`mkdir` with `recursive`), as `InMemoryFs` does in memory. `MountableFs` and the rules' wrapper only pass the call on. Upstream relies on this for its virtual default (a `Bash` given files has no `/tmp`, and its own tests write there), and one of its tests asserts it.

## Options weighed

**Stop making folders in our filesystem wrapper.** Rejected: it is a downstream wrapper over a just-bash behavior, the shape [the rmdir decision](2026-10-03-carry-the-rmdir-patch.md) ruled out, and the wrapper cannot tell a redirect from the commands (`tar -x`, `cp`) that may rely on `writeFile` making folders.

**Change upstream's default to bash's behavior.** Tried: it breaks six of upstream's own tests that write into `/tmp` or `_tmp/` without making it, and any embedder doing the same, so it is offered in the pull request as an alternative rather than sent.

**Add an option upstream and set it.** Chosen. [vercel-labs/just-bash#589](https://github.com/vercel-labs/just-bash/pull/589) adds `redirectCreatesDirectories` to `BashOptions`, default true; set false, a redirect checks its target's folder first and fails the command with bash's message. The PR builds on #561's error path, which 3.6.0 lacks, so it is carried as `redirect-directories-3.6.0.diff`, ported over the refused writes part. `create-bash-env.ts` sets it false.

## Decision

Carry the twenty-first part of `patches/just-bash@3.6.0.patch`, ported from #589, until it is in a version we install. `create-bash-env-redirect-folder.test.ts` is the guard. `tee` and the commands that write through `writeFile` still make missing folders, which the PR leaves as a separate question.
