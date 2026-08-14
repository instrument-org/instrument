# The test suites spend most of their time re-evaluating module graphs, not running tests

**Status:** the three fixes below have landed. One lever is left, and it is the largest single one remaining.

Vitest isolates every test file: each one gets its own module registry, so every module in its import graph is evaluated once per test file that reaches it. A package's suite therefore costs `files x graph`, and a heavy module in a widely-reached position costs about a second per test file however trivial the tests are.

That is what the suites were paying. Measured on a 10-core machine, before and after.

| Run | Before | After |
|---|---|---|
| `turbo run test:ci` (all three packages) | 89.5s | 32.6s |
| ...CPU seconds | 331s | 202s |
| ...peak processes / RSS | 40 / 6.2 GB | 24 / 4.3 GB |
| `packages/workspace` alone | 30.0s | 13.7s |
| `apps/studio` node + dom alone | 23.5s | 16.2s |

## Where the time was

**A barrel in a setup file, paid by every test file.** `packages/workspace/src/test/setup.ts` imported `noopModelCache` from the root of `@instrument-org/ai-gateway`, whose barrel re-exports the gateway's Hono app and the model-fetching stack. That is ~1.35s of module evaluation, times 150 test files: the run reported **190 seconds of setup time** against 23 seconds of tests. The same barrel reached the mock task config helper, which 57 test files import, for another ~1.09s each.

The gateway now has two leaf subpaths, `./model-cache` and `./schemas`, and the test helpers import from those. The three `TEST_*_OVERRIDE_KEY` constants moved to `schemas/provider-config.ts`, beside the config they are stamped onto rather than among the AI SDK providers that read them; the package root still exports them, so no consumer changed. Setup time went from 190s to 6.7s.

**One test file holding the whole transcript sweep.** `frames-render.test.tsx` drew 942 frames in a single test: ~15ms each, ~14s, in one worker, finishing long after the other 32 dom files were done. Vitest's unit of parallelism is the file, so it is now three shard files taking every third scenario, and the dom project's tail dropped from 19.1s to 12.6s.

**Three worker pools on one machine.** Turbo runs the three packages' `test:ci` concurrently, and each Vitest instance defaults to `cpus - 1` workers, so a 10-core machine ran 27 forks plus the pools' own overhead. Capping each at `--maxWorkers=40%` costs nothing in wall clock and takes ~2 GB off the peak, which is what matters when several checkouts run the suite at once.

| Concurrent `test:ci` | Wall | Peak RSS |
|---|---|---|
| default workers | 33.2s | 6.2 GB |
| `--maxWorkers=40%` | 32.6s | 4.3 GB |
| `--maxWorkers=33%` | 37.2s | 4.4 GB |
| `turbo --concurrency=1`, default workers | 34.8s | 4.4 GB |

The cap is on `test:ci` and not in `vitest.config.ts`, because it is only right when three suites share the machine: a single package run is 60% slower with it (workspace 13.7s -> 21.5s).

## What is left: `@phosphor-icons/react`

The icon package's root re-exports 3024 separate modules. Node takes **914ms** to import it, and Vite does not transform it, so nothing in the test config changes that: it is the module resolver. 135 studio source files import it, so effectively every dom and browser test file pays it once, around a second each.

Measured attempts that do not work:

| Attempt | Cost per test file |
|---|---|
| As-is | 1.09s |
| `test.deps.optimizer.ssr.include` | 1.14s (no effect) |
| `ssr.optimizeDeps` + `noExternal`, or `server.deps.inline` | 7.7s (much worse) |
| Alias to `dist/ssr` | 0.73s, but that is the SSR build, not the components the app renders |
| Alias to `dist/index.cjs.js` | fails: the package is `type: module`, so its own `.cjs.js` is parsed as ESM |

The fix that works is importing icons by their deep paths (`@phosphor-icons/react/dist/csr/Check.es.js`), which is what the package documents for exactly this reason. It is a mechanical change across 135 files, and it would speed up the dev server too, but it is a refactor rather than a config change, so it is written down here rather than done.

## The general shape

Two rules follow from `files x graph`:

- A setup file's import graph is multiplied by every test file in the package. Keep it to leaves.
- A package barrel that re-exports a server, a client, and its schemas costs any consumer of the schemas the whole thing. Under a bundler that is free; under a test runner it is not.

Type-only imports are exempt: `isolatedModules` is on and `verbatimModuleSyntax` is not, so `import { type X } from "barrel"` is erased and evaluates nothing.
