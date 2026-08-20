# anti-slop is not part of the lint pipeline

Date: 2026-08-15

## Decision

[anti-slop](https://github.com/dmmulroy/anti-slop) was vendored, wired into `.oxlintrc.json`, measured, and removed. The findings it surfaced were fixed and kept; the plugin was not.

This is a record of what it found, so nobody re-runs the evaluation in six months without knowing the numbers.

## What it found

A scan of `apps` and `packages` with all fifteen rules on reported 1,097 findings across 376 files. Five rules had a low enough false-positive rate here to be worth enabling: `no-object-parameters`, `no-reflect-apply`, `no-reflect-get`, `no-unknown-type-aliases`, `no-widen-then-assert`. They accounted for four of the 1,097.

Run against the tree at five points in history, those five rules yield:

| snapshot | findings |
| --- | ---: |
| 2025-11-14 | 0 |
| 2026-02-13 | 0 |
| 2026-05-14 | 0 |
| 2026-07-13 | 2 |
| 2026-08-14 | 4 |

Four findings across the repository's whole history. One is a false positive (a `Proxy` get trap in `apps/studio/web/src/mock-rpc.ts`, where forwarding a symbol to the target is what `Reflect.get` is for). None of the three real ones was a bug: two `object`-typed parameters on a hand-rolled parser and one `Reflect.get` on a provider error body, all type-evidence complaints with no runtime consequence.

## Why it is not enabled

**The quiet rules are quiet because they find nothing.** Rule selection traded noise for yield and got both. The finding with actual failure potential — `getCachedResult<T>` asserting a caller-named type out of a shared `LRUCache<string, object>`, so two call sites colliding on a key would return a confidently-typed wrong object — came from `require-safety-comment-for-type-assertion`, which is not enabled and should not be. That rule reports 388 diagnostics at 351 sites: 159 in tests and tooling where casting is how a test double is built, 22 the XState `setup({ types: { context: {} as Ctx } })` idiom, and 36 where a comment already sits within three lines of the cast but does not open with the token `SAFETY:`. Its signal is the presence of a token, not of a justification.

**The high-volume rules fire on conventions chosen deliberately.** `no-known-value-widening` (159) flags `const LABELS: Record<ThemeOption, string> = {...}`, where the annotation is what makes the map exhaustive. `no-conditional-empty-object-spread` (27) flags `...(cond ? { key } : {})`, the way an optional property is omitted. `no-module-mocking` (81 across 43 files) would be a testing-strategy rewrite. `no-runtime-typeof` (165) and `no-unknown-parameters` / `no-unknown-returns` (148) both argue for parsing at the boundary and branching on the domain value, and their hits are largely the boundary parsers themselves — the rule cannot tell a guard's implementation from a caller that skipped one.

**Runtime cost is not the reason.** It is close to nothing. Measured on the command `check:lint` runs, four runs each, with the rules verified firing against a probe file:

| | without | with |
| --- | ---: | ---: |
| `packages/workspace`, `oxlint --type-aware` | 1.83–1.93s | 1.92–2.03s |
| `apps/studio`, `oxlint --type-aware` | 2.75–2.79s | 2.75–2.89s |

Roughly +0.1s on workspace and nothing distinguishable from noise on studio. Any measurement claiming otherwise is probably reading an early exit: removing `jsPlugins` while leaving the `anti-slop/*` rules in the config makes oxlint fail with `Plugin 'anti-slop' not found` in about 0.48s without linting anything, which reads as a fast baseline and is not one.

What the plugin does cost is 2,221 lines of vendored source and a `@oxlint/plugins` pin that has to move in lockstep with `oxlint` on every upgrade.

## What was kept

The findings, fixed in the four commits preceding the revert:

- `packages/ai-gateway/src/lib/cache.ts` — `createResultCache<T>()` per value type, replacing the shared store and its assertion.
- `packages/workspace/src/lib/web-search.ts` — Perplexity tool output parsed with a schema instead of predicates over `object`.
- `packages/workspace/src/lib/classify-provider-error.ts` — own-property lookup instead of `Reflect.get`.
- `packages/workspace/src/lib/create-bash-env.ts` — `BROKEN_COMMANDS` typed for the names just-bash reports, dropping two call-site casts.
- `apps/studio/src/electron-main/auth/client.ts` — the OAuth state parsed rather than asserted. It is gated by the stored-state comparison in `auth/server.ts`, so this closed an assumption, not a hole.
- `apps/studio/src/client/routes/_app/_authenticated/subscribe.tsx` — the API's plan name narrowed by lookup instead of cast into a closed union.
- `apps/studio/src/client/lib/task-file-groups.ts` — `PROMINENT_TOP_LEVEL_DIRS` typed as `Set<string>`, dropping `as never`.

## If this comes up again

The scan is cheap to repeat: vendor the plugin to a scratch directory, point a standalone oxlint config at it with all fifteen rules on, and run it against `apps packages`. Check the output has findings in it before trusting a run, since a misconfigured plugin fails fast and looks like a clean pass.

This was a close call, and it rests on yield alone: three real findings in ten weeks, none of them bugs, against a vendored tree and a version pin. It would be reasonable to decide the other way, particularly if the vendored source is ever pruned to just the enabled rules. What would settle it is a rule set whose yield is bugs rather than type hygiene.

Note that this repo already runs type-aware oxlint with `no-explicit-any`, the `no-unsafe-*` family, and `consistent-type-assertions`, which is why the casual version of these patterns is already absent and what remains is deliberate.
