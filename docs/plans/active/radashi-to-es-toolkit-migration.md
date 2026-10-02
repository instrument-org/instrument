# Plan: radashi → es-toolkit migration (Instrument monorepo)

**Status:** planned, not started (checked 2026-10-02: radashi is imported in 121 files, es-toolkit in none). Land it late in a quiet stretch to avoid a stale/conflict-heavy diff.

---

## Background / why

A tab-persistence bug investigation surfaced that `radashi`'s `debounce` has non-lodash semantics that mislead both humans and AI agents:

- `.cancel()` **permanently deactivates** the debounce (later calls fire immediately), not lodash's "clear the pending timer."
- `.flush(...args)` **re-invokes with args you pass**; it does _not_ replay the stored pending call.
- No `trailing` / `maxWait` options.

radashi is also the smallest/slowest-moving of the candidates (a low-velocity radash fork). Decision: **standardize on `es-toolkit`**, retiring radashi.

### Why es-toolkit (verified July 2026)

- Lodash-faithful semantics: `cancel` clears pending, `flush` replays the stored call, `leading`/`trailing`/`maxWait` via `es-toolkit/compat`.
- Most actively maintained modern option (~32M weekly dl, near-daily commits, v1.49 Jun 2026), TS-first, best size/perf. `es-toolkit/compat` gives near drop-in lodash parity (safety net). `es-toolkit/fp` exists if data-last piping is ever wanted.
- **remeda was considered and rejected for this purpose**: it _deprecated_ `debounce` in v2.19.0 (Dec 2024) in favor of the lower-level `funnel` primitive, which is more ceremony and worse for agents reaching for a plain `debounce`. remeda remains a fine choice only if piped, strongly-typed data pipelines become a house style (that is how the `opencode` reference repo uses it: remeda for data-last transforms plus a hand-rolled debounce, never a library for timing).

---

## Already done (do NOT redo)

Commit **`b4d92b82a`**: `studio: flush pending tab-state write on renderer teardown`. File: `apps/studio/src/client/atoms/tabs.ts`. This fixed the original bug (debounced `localStorage` write dropped on fast quit/reload, so the app restored to `/new-tab` instead of the just-created task) and deliberately **sidesteps radashi's `flush`** by tracking the pending value itself and flushing on `pagehide`/`beforeunload`. It is library-agnostic, so the es-toolkit migration does not need to revisit its logic (just the `debounce` import). `check:types` + `check:lint` pass for studio.

---

## Migration plan (difficulty: closer to simple than terrible)

~80% is mechanical import renames that `tsgo` will police. ~20% needs a decision or a per-site semantics check. Estimate: focused half-day to a day, parallelizable per package.

### Footprint (radashi imports, 121 files as of 2026-10-02)

Most-used: `dedent` (~25, mostly workspace tool/agent prompts), `noop` (~12), `isEqual` (~7), `parallel` (~6), `alphabetical` (~6), `unique` (~5), `sleep` (~4), `pick`/`sort` (3), `sift`/`fork` (2), plus singletons: `sum`, `clamp`, `capitalize`, `title`, `objectify`, `shake`, `draw`, `assign`, `listify`, `get`. `debounce`: **7 non-test sites**: `apps/studio/src/client/atoms/tabs.ts`, `.../atoms/prompt-value.ts`, `.../components/user-message.tsx`, `.../components/model-context-debug-card.tsx`, `.../components/message-part/tool-card.tsx`, `.../components/settings/memory-section.tsx`, `apps/studio/src/electron-main/windows/window-bounds.ts`.

Regenerate the footprint before starting (it will have drifted):

```
rg -oN "import \{([^}]*)\} from ['\"]radashi['\"]" -r '$1' -g '!**/node_modules/**' \
  | tr ',' '\n' | sed 's/^ *//;s/ *$//' | rg -v '^$' | sort | uniq -c | sort -rn
```

### Bucket 1: drop-in / pure rename (bulk of sites)

Same name: `noop`, `isEqual`, `pick`, `get`, `sum`, `clamp`, `capitalize`. Rename: `sleep→delay`, `unique→uniq`, `sift→compact`, `fork→partition`, `draw→sample`, `sort`/`alphabetical→sortBy`/`orderBy`. Find-replace + compile check.

### Bucket 2: no equivalent, decide replacement ONCE (then mechanical)

- **`dedent` (~25 sites):** es-toolkit has none (radash-ism). Use the standalone `dedent` npm package (same tagged-template shape) or a ~5-line helper. High count, trivial swap.
- **`parallel` (~6 sites):** concurrency-limited promise pool, no es-toolkit equivalent. The one spot where semantics matter for correctness. Keep a tiny helper or add `p-limit`.
- Oddballs (1-2 sites each): `shake`, `listify`, `objectify`, `title`, `assign` resolve via `es-toolkit/compat` (`omitBy`/`keyBy`/`merge`/`startCase`) or a 3-line hand-roll. Verify each individually.

### Bucket 3: the 7 debounce sites (the whole point; do by hand, last)

Swap to es-toolkit `debounce` and re-verify each because cancel/flush semantics change. Concrete example to eyeball: `electron-main/windows/window-bounds.ts` calls `saveSoon.cancel()` before saving directly. Under radashi `.cancel()` deactivates; under es-toolkit it only clears the pending timer. That site stays correct (it calls `saveState()` right after), but confirm per-site rather than blind-replacing. `atoms/tabs.ts` only uses `debounce` for scheduling now (see "already done"), so it just needs the import swapped.

### Suggested sequencing

1. Add `es-toolkit`; keep `radashi` installed through the transition. Settle the two Bucket-2 decisions (`dedent` dep, `parallel` helper) up front.
2. Migrate package-by-package (`@instrument-org/workspace` is dedent-heavy and mostly mechanical; `@instrument-org/studio` has the debounce + misc). Run `tsgo` + tests after each package.
3. Do the 7 debounce sites by hand.
4. Remove `radashi`, run full checks.

---

## Open decisions before starting

1. **`dedent` replacement:** standalone `dedent` package vs a small in-repo helper.
2. **`parallel` replacement:** in-repo concurrency helper vs `p-limit`.

---

## Verification

- `pnpm exec turbo run check:types check:lint --filter=@instrument-org/workspace`
- `pnpm exec turbo run check:types check:lint --filter=@instrument-org/studio`
- Per-package tests from the repo root: `pnpm --filter @instrument-org/workspace exec vitest run` / `pnpm --filter @instrument-org/studio exec vitest run`.
- Full: `pnpm check-and-test:ci`.
- Package management note (from CLAUDE.md): run `pnpm add/remove` **outside** the sandbox (full permissions); `pnpm test`/`check-and-test` are sandbox-OK.
- Commit style: scope-first, no conventional-commit types (e.g. `deps: replace radashi with es-toolkit`). See `.agents/skills/instrument-commit-message`.

## Suggested skills for the next agent

- **`instrument-commit-message`**: for per-package migration commits.
- **`verify`**: sanity-check the behavior-changing spots (the 7 debounce sites, especially the electron-main cancel/flush semantics; `parallel` concurrency).
- **`code-review`**: optional final pass over the full diff before landing.
- **`typescript-result`**: only relevant if any migrated site touches Result/error handling; the migration itself is utility-only, so likely not needed.

## Reference material (already explored, don't re-research from scratch)

- The `opencode` project (open-source coding agent) is a useful functional-style reference: Effect + remeda only, hand-rolls all timing utils. Relevant only if you later consider remeda for data pipelines, not needed for the es-toolkit swap.
