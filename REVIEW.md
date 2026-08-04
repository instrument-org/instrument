# Review instructions

Focus on correctness and user impact. The rules below only calibrate what the review flags and how it reports findings.

## What Important means here

Use 🔴 Important for concrete defects that should be fixed before merging. Preserve the default bar for correctness bugs, security vulnerabilities, and regressions, and pay particular attention to:

- **Containment regressions.** The agent must stay within the `/task`, `/skills`, and read-only `/mnt` layout. Widening the real-binary path bridge, `agent-browser` allowlist, or git argv/env policy is Important.
- **Packaging and release breakage.** Main-process runtime packages belong in `dependencies`, renderer-only packages in `devDependencies`, and native binaries may require `asarUnpack`. Flag changes that work locally but break or materially bloat the packaged app.
- **Data loss or incompatibility.** Changes must preserve `tasks/<id>/.instrument/{task.db,settings.json}` and continue loading data written by the previous release unless they include a migration.
- **Privacy leaks.** Prompts, agent messages, file contents, user paths, API keys, and `.env` values must not reach telemetry, logs, or unintended network destinations.
- **Agent-turn correctness.** Flag deterministic tool, prompt, message-assembly, or state-management defects that make turns fail, hang, or silently drop state.

Naming, structure, refactor suggestions, prose style, and test organization are 🟡 Nit at most.

## Cap the nits

Report at most five Nits per review. If you found more, say "plus N similar items" in the summary instead of posting them inline.

## Do not report

- Anything `pnpm check-and-test` already enforces: formatting, lint, type errors, spelling, markdownlint, knip, and lockfile policy.
- Changes under `registry/`, which is a read-only git submodule.
- Generated outputs: `apps/studio/src/client/routeTree.gen.ts`, `apps/studio/icons/.generated-hashes.json`, and `pnpm-lock.yaml`.
- Version bumps in release commits.
- Documentation style, structure, or completeness. Do report factual claims that conflict with the implementation or with changes in the same PR.
- General requests for more tests. Report a missing test only when the changed behavior is important and the existing test projects can observe it.

## Always check

- **Studio privilege boundaries.** Renderer code must not import Electron, Node built-ins, or platform API modules directly. Privileged operations use the narrow preload API or main-process oRPC, and remote Instrument API calls go through main-process routes. Fetching task files from validated localhost workspace URLs is expected.
- **Workspace error handling.** Do not discard neverthrow `Result` errors. Expected tool failures stay typed through the tool boundary, and RPC handlers map known failures with `toORPCError`; internal invariant failures may still throw.
- **Persisted shapes.** Changed Zod schemas, database columns, and state keys must remain backward compatible or include a migration.
- **Session-context freshness.** Values derived from `agent.getMessages` are a startup snapshot fixed for the life of the session. Values required in a later turn must be attached to that turn as a persisted `data-*` part, and rendering one must be deterministic from what is stored.
- **Test observability.** jsdom cannot verify browser-owned layout, scrolling, caret, or selection behavior. Those assertions belong in `*.browser.test.tsx`; every added regression test should fail against the unfixed behavior.

## Verification bar

- Cite `file:line` in source for every claim about behavior. `CLAUDE.md` and architecture docs describe intent; trace the implementation before reporting a finding.
- Do not post unverified hypotheses as findings. Deterministic agent-facing wiring defects may be Important when the code path proves them; omit claims about model choices that cannot be verified statically.
- Prefer one finding on the root cause over one per call site.

## Re-review convergence

On a re-review, post Important findings only, plus Nits on code introduced since the previous review. Do not re-raise resolved or previously reported Nits.

## Summary shape

Open with a one-line tally such as `2 important, 4 nits`, followed by the areas touched. When there are no correctness findings, say "No correctness issues" first and put any Nits below it.
