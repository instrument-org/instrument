# The test suites spend most of their time re-evaluating module graphs, not running tests

**Status:** all four fixes below have landed, the last of them enforced by a lint rule.

Vitest isolates every test file: each one gets its own module registry, so every module in its import graph is evaluated once per test file that reaches it. A package's suite therefore costs `files x graph`, and a heavy module in a widely-reached position costs about a second per test file however trivial the tests are.

That is what the suites were paying. Measured on a 10-core machine, before and after. The studio figure includes deleting a test rather than speeding it up, which is the last section here and the largest single saving in that package.

| Run | Before | After |
|---|---|---|
| `turbo run test:ci` (all three packages) | 89.5s | 32.6s |
| ...CPU seconds | 331s | 202s |
| ...peak processes / RSS | 40 / 6.2 GB | 24 / 4.3 GB |
| `packages/workspace` alone | 30.0s | 13.7s |
| `apps/studio` node + dom alone | 23.5s | 10.8s |

## Where the time was

**A barrel in a setup file, paid by every test file.** `packages/workspace/src/test/setup.ts` imported `noopModelCache` from the root of `@instrument-org/ai-gateway`, whose barrel re-exports the gateway's Hono app and the model-fetching stack. That is ~1.35s of module evaluation, times 150 test files: the run reported **190 seconds of setup time** against 23 seconds of tests. The same barrel reached the mock task config helper, which 57 test files import, for another ~1.09s each.

The gateway now has two leaf subpaths, `./model-cache` and `./schemas`, and the test helpers import from those. The three `TEST_*_OVERRIDE_KEY` constants moved to `schemas/provider-config.ts`, beside the config they are stamped onto rather than among the AI SDK providers that read them; the package root still exports them, so no consumer changed. Setup time went from 190s to 6.7s.

**One test file holding the whole transcript sweep.** `frames-render.test.tsx` drew 942 frames in a single test: ~15ms each, ~14s, in one worker, finishing long after the other 32 dom files were done. Vitest's unit of parallelism is the file, so it became three shard files taking every third scenario, and the dom project's tail dropped from 19.1s to 12.6s.

Then it went entirely, which was the better answer. Asking what it was worth rather than only what it cost: four real regressions were introduced under it -- a leaking fold, an empty group box, a lost live gate, an in-flight row drawn twice -- and it caught one, which the component tests around `chat-stream` caught as well, along with all three it missed. Two of its three rules could no longer fail: one selector named a `data-attribute` that exists nowhere in the app, and the other needed a box rendered literally childless, which no realistic break produces. Its sibling `frames.test.ts` asserts the same fold invariants against the data instead of the DOM, in 311ms rather than 14.5s.

**Three worker pools on one machine.** Turbo runs the three packages' `test:ci` concurrently, and each Vitest instance defaults to `cpus - 1` workers, so a 10-core machine ran 27 forks plus the pools' own overhead. Capping each at `--maxWorkers=40%` costs nothing in wall clock and takes ~2 GB off the peak, which is what matters when several checkouts run the suite at once.

| Concurrent `test:ci` | Wall | Peak RSS |
|---|---|---|
| default workers | 33.2s | 6.2 GB |
| `--maxWorkers=40%` | 32.6s | 4.3 GB |
| `--maxWorkers=33%` | 37.2s | 4.4 GB |
| `turbo --concurrency=1`, default workers | 34.8s | 4.4 GB |

The cap is on `test:ci` and not in `vitest.config.ts`, because it is only right when three suites share the machine: a single package run is 60% slower with it (workspace 13.7s -> 21.5s).

## `@phosphor-icons/react`, and why no config could fix it

The icon package's root re-exports 3024 separate modules. Node takes **914ms** to import it, and Vite externalizes it rather than transforming it, so nothing in the test config reaches it: the cost is in the module resolver. 135 studio source files imported it, so effectively every dom and browser test file paid it once.

Everything tried at the config layer, measured per test file:

| Attempt | Cost per test file |
|---|---|
| As-is | 1.09s |
| `test.deps.optimizer.ssr.include` | 1.14s (no effect) |
| `ssr.optimizeDeps` + `noExternal`, or `server.deps.inline` | 7.7s (much worse) |
| Alias to `dist/ssr` | 0.73s, but that is the SSR build, whose icons cannot read `IconContext` |
| Alias to `dist/index.cjs.js` | fails: the package is `type: module`, so its own `.cjs.js` is parsed as ESM |
| **Per-icon subpath** | **19ms** |

So the imports moved: `@phosphor-icons/react/Check` rather than the root, through the wildcard subpath the package exports (`"./*"` -> `dist/csr/*.es.js`, types included). `IconContext` comes from `dist/lib/context`.

**The name is not always the module.** 18 of the exported names are aliases for a renamed icon, so stripping the `Icon` suffix gets the wrong file: `ActivityIcon` lives in `csr/Pulse`, `ArchiveBoxIcon` in `csr/BoxArrowDown`, `CircleWavyCheckIcon` in `csr/SealCheck`. The mapping was read out of the package's own barrel rather than guessed.

Measured by aliasing the subpaths back to the root and running both ways under one load:

| studio project | subpaths | root barrel |
|---|---|---|
| dom, import time | 38s | 63s |
| dom, CPU seconds | 65s | 87s |
| browser, wall | 11.2s | 16.3s |
| browser, CPU seconds | 32s | 55s |

`@typescript-eslint/no-restricted-imports` in the shared React config holds the line, with `allowTypeImports` on: a type-only import is erased before anything runs, so `Icon` and `IconProps` stay on the root at no cost. `typescript.preferences.autoImportSpecifierExcludeRegexes` keeps the editor from suggesting the root in the first place, which is where the rule would otherwise keep firing.

## The general shape

Two rules follow from `files x graph`:

- A setup file's import graph is multiplied by every test file in the package. Keep it to leaves.
- A package barrel that re-exports a server, a client, and its schemas costs any consumer of the schemas the whole thing. Under a bundler that is free; under a test runner it is not.
- A slow test is worth asking what it catches before asking how to make it cheaper. Sharding the sweep was the smaller win; deleting it was the larger one, and mutation testing is what told them apart.

Type-only imports are exempt: `isolatedModules` is on and `verbatimModuleSyntax` is not, so `import { type X } from "barrel"` is erased and evaluates nothing.
