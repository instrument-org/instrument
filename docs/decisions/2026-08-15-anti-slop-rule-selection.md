# Five of anti-slop's fifteen rules are on

Date: 2026-08-15

## Decision

[anti-slop](https://github.com/dmmulroy/anti-slop) is vendored at `tools/oxlint/anti-slop/` as an unmodified copy of upstream, registered in `.oxlintrc.json` as a `jsPlugins` entry, with five of its fifteen rules enabled at `error`:

- `no-object-parameters`
- `no-reflect-apply`
- `no-reflect-get`
- `no-unknown-type-aliases`
- `no-widen-then-assert`

The other ten stay registered and off. The whole plugin is vendored rather than trimmed to the five, so re-syncing upstream is a copy rather than a merge, and turning a rule on later is a config edit.

`jsPlugins` merges across `extends`, so declaring it once in the root config reaches `apps/studio` and `packages/shim-client`, which have their own configs, and every package that inherits the root one directly.

## Why

A scan across `apps` and `packages` with all fifteen rules on reported 1,097 findings in 376 files. The five above accounted for four of them, all true positives, all now fixed. The other ten accounted for the remaining 1,093.

Volume alone was not the disqualifier. Three things were:

**A rule that fires on the convention.** `no-known-value-widening` (159) flags `const LABELS: Record<ThemeOption, string> = {...}`, where the annotation is what makes the map exhaustive; inference would silently accept an incomplete one. `no-conditional-empty-object-spread` (27) flags `...(cond ? { key } : {})`, the way an optional property is omitted. `no-module-mocking` (81 across 43 files) would be a testing-strategy rewrite.

**A rule that cannot see the distinction it is arguing for.** `no-runtime-typeof` (165) and `no-unknown-parameters` / `no-unknown-returns` (148) both say to parse at the boundary and branch on the domain value. We do, and the hits are largely the boundary parsers themselves: `typeof value === "string"` inside a type guard, `migrateTaskState(state: unknown)`. The rule cannot tell a guard's implementation from a caller that skipped one.

**A rule whose finding is a format.** `require-safety-comment-for-type-assertion` is 388 of the 1,097 at 351 sites: 159 in tests and tooling, where casting is how a test double is built; 22 the XState `setup({ types: { context: {} as Ctx } })` idiom; 36 where a comment already sits within three lines of the cast but does not open with the token `SAFETY:`. `packages/ai-gateway/src/lib/image-capabilities.ts:184` states the invariant, the threat model, and where the validation happened, and is still reported. The remaining ~134 are a real backlog, but the rule's signal is the presence of a token, not of a justification.

`no-unsafe-dictionary-type` (65) is the closest call among the rejected ten: `Record<string, unknown>` is often a real smell, but it is also the honest type for a settings blob being merged or a telemetry property bag, and the rule does not distinguish them.

## Alternatives

- **Enable everything and suppress.** Rejected. Landing seven high-volume rules needs either a 100+ site migration or a per-file suppression campaign, and a rule that arrives with a wall of `oxlint-disable` teaches everyone to reach for one.
- **Trim the vendored copy to the five enabled rules.** Smaller tree, but every future upstream sync becomes a merge, and the ten rules we declined are the ones worth re-reading when the codebase changes shape.
- **Take the findings and skip the plugin.** The four fixes were worth having on their own. The five rules stay because they are the ones that cost nothing to keep: their combined steady-state output on this codebase is zero, and this is a product that writes TypeScript, so the patterns they catch are ones a model reaches for more readily than a person does.

## Costs

`no-reflect-get` has one known false positive, at `apps/studio/web/src/mock-rpc.ts:47`: forwarding a symbol to the target inside a `Proxy` get trap is what `Reflect.get` is for, and the alternative needs a cast to index a function by symbol. It carries a line-scoped disable with that reasoning. Any future proxy trap will need the same, which is the price of the rule.

`@oxlint/plugins` is pinned to `1.76.0` to match this repo's `oxlint`, not to upstream anti-slop's `1.78.0`; the two move together and should be bumped together.
