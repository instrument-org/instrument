# Carry a pipe handoff in just-bash as a local patch

Date: 2026-10-15

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

just-bash runs a pipeline's stages one after another and hands each stage the previous one's whole stdout as a string (`pipeline-execution.ts`). For the native programs most of the shell's text work now runs on (uutils, `rg`, `git`, the interpreters, anything on the PATH) that means every byte crosses the interpreter twice, is held in memory between stages, and counts against the output limits, and a consumer that exits early cannot stop its producer. Measured on macOS through the shell: a 34 MB `sort | uniq -c | wc -l` over uutils took 7.3 s against 0.85 s in bash, `rg needle | head -2` over 507 MB of matches 29.8 s, and `yes | head -3` ran until an output limit stopped it 23 s later.

Upstream's streaming work, #453, streams `cat`, `head` and `seq` through a new stdio interface. It is large, conflicts with `main`, drew a high-risk automated review, and a maintainer called it possibly too large to take. It would also not help native programs until each one wrote through that interface.

## Decision

Carry a local diff, `patches/just-bash-sources/native-pipes-3.6.0.diff`, as the `pipe handoffs` part of `patches/just-bash@3.6.0.patch`:

- A simple command whose stdout feeds a simple command is told it may hand its stdout over (`ctx.offerPipeHandoff`) and may return a `pipeHandoff`: an opaque token and a `settle` function.
- A command that sets `acceptsPipeHandoff` (true, or a function of its arguments) receives the token as `ctx.stdinHandoff`. Any other stage, and a stage with a redirection, a builtin, a function, or a compound command, gets the bytes by settling the handoff, as before.
- Every handoff is settled after the last stage, for `PIPESTATUS`, `pipefail` and stderr. A trusted command's `settle` runs trusted, as its `execute` did.

The interface carries no Node types, so the patch is no larger than the interpreter half; the Node half lives in `shell-commands/pipe-stage.ts`, which joins two programs with an OS pipe. The upstream pull request is on hold by decision, so the diff stays local; `src/interpreter/pipeline-handoff.test.ts` in the diff and `create-bash-env-native-pipes.test.ts` here are the guards.

## Alternatives

- Wait for #453: rejected, since it streams only builtins and has stalled.
- One `sh -c` under one sandbox wrap for each run of native stages: rejected, since it merges every stage's stderr, so a refused path can no longer be attributed to the stage that hit it, and it needs shell quoting of host paths (and a shell on Windows).
- A FIFO from `mkfifo` per pipe, to avoid the private `readStop` on Node's child stdio streams: rejected, since Node has no `mkfifo`, so it costs a process per pipe, and Windows has no FIFO.
- Moving the shell to brush for real OS pipes: still a later spike once its `ProcessLauncher` hook is released; this covers the native case now on every platform the app ships.
