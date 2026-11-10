# Whether tests still go red only on Windows after they land

**Status:** open · **Check after:** 2026-11-24 · **Last checked:** 2026-11-10

## What we're waiting to learn

Since the workspace tests began running on Windows, most of main's red CI runs were tests that passed on the machine they were written on and failed only on Windows, each staying red until someone read the log: for 25 runs in one case, 8 in another. Two causes covered the long streaks of the past month:

- **A database left open** when the test or the code under it removed or renamed its folder, which Windows refuses. d2a1bcb13 makes the workspace tests refuse the same way on macOS and Linux, so that failure shows where the test is written. 4de4b6c1b fixed the case that had main red when it landed.
- **A path made with `path.join` or `path.relative` captured in a snapshot**, where Windows writes a backslash. Nothing catches this before Windows. A Windows-only snapshot serializer that wrote separators as `/` was tried and dropped: it broke six snapshots that show Windows spellings on purpose.

The question is whether red Windows shards on main are now rare and short, and which cause the remaining ones have.

## The signal

Failed first attempts of the CI workflow on main where only Windows test shards failed, grouped into streaks of consecutive red runs on the same test file. For each streak, its length in runs and the cause, read from the failing test's assertion:

- An `EPERM` or `EBUSY` from removing or renaming a folder: an open file the fake does not cover. The fake knows only `node:sqlite` databases, so this is most likely a file handle or a child process still running in the folder.
- A snapshot whose only difference is `\` against `/`: the separator cause.
- Anything else: a Windows difference not seen before.

A streak that starts with d2a1bcb13's own `EPERM: operation not permitted ... is still open` message on Linux shards means the fake caught a leak before Windows did, which is the fake working.

## Where to look

The GitHub Actions API for this repo's CI workflow on main, `--log-failed` for each red run, filtered to the `Tests (Windows n/4)` jobs.

## What each answer means

- **No Windows-only streaks longer than two runs:** close it.
- **Open-handle streaks from something other than a database:** extend the fake in `packages/workspace/src/test/helpers/windows-file-locks.ts` to that kind of handle.
- **Separator streaks recurring more than about twice a month:** look again for a check that can tell a separator from a Windows spelling a test wants, such as a lint rule on `path.relative` results passed to a snapshot.
- **A new kind:** write it up in `docs/findings/` and decide there whether a fake is worth building.

## Result
