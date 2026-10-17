# The full gate flakes on a busy machine, one different test each time

**Status:** open, and not worth a fix in the suites. Read this before chasing a failure that only `check-and-test:ci` shows.

`pnpm check-and-test:ci` runs both packages' suites through Turbo at the same time, each at `--maxWorkers=40%`. Together that asks for about four fifths of the cores, and anything else on the machine — another agent's test run, a packaged build, a driven app instance — pushes it past what the box has. Past that line, tests that assert on timing or on the file system start failing for want of a slice rather than for a reason.

The tell is that **a different test fails each run**. Four consecutive gate runs on one unchanged tree failed four disjoint sets:

| Run | What failed | Alone |
|---|---|---|
| 1 | `date-change`, `message-gap`, `permissions/places` | pass |
| 2 | `missing-key-folders` (a real flake, since fixed) | pass |
| 3 | one file, unnamed in the output | pass |
| 4 | `workspace-fs-layout`, `native-sandbox` | pass |

Each package's suite run **on its own** passes whole: 371 files in `@instrument-org/workspace`, 301 in `@instrument-org/studio`. So the gate's own concurrency is the variable, not the tests.

## What to do about a gate failure

1. Re-run the named file alone, from the repo root: `pnpm --filter @instrument-org/workspace exec vitest run <path>`. If it passes, it was contention.
2. Run each package's suite on its own (`pnpm --filter <pkg> run test:ci`). Two green suites and a red gate is this finding, not a regression.
3. Only if the **same** test fails twice under the gate and passes alone is there something to look at, and then it is usually shared state between files rather than timing.

What not to do: widen a timeout so a loaded run passes. It hides the next real failure in that file and it does not make the gate reliable, because the next run fails somewhere else. A test that is genuinely timing-dependent should instead be given a seam so it can say the event arrived — `watchKeyFolders` takes its `fs.watch` that way, after the gate caught it waiting on a real one.

## Why CI does not see it

A CI runner gives the job the whole machine, so 40% plus 40% fits. This is a local-only property of running the gate beside other work, and it is worse on a slower machine: the caps in the suites were tuned on a faster one, so the same percentage of cores is fewer effective cycles here.
