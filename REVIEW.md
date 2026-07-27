# Review instructions

Instrument is an Electron desktop app that runs an AI agent on the user's own
machine, inside a per-task folder. The things that hurt here are the ones that
widen what that agent can reach, break the packaged app, or lose a user's work.
Style is handled by tooling; spend the review on behavior.

## What Important means here

Reserve 🔴 Important for findings that would break behavior for a user running
the shipped app:

- **Containment regressions.** A change that lets the agent read, write, or
  execute outside the layout in `docs/architecture/agent-sandbox.md` — the task
  dir at `/task`, `skills/` at `/skills`, attached folders read-only under
  `/mnt`. Anything that widens the real-binary path bridge, the `agent-browser`
  allowlist, or the git argv/env policy is Important even when it looks like a
  simplification.
- **Packaging breakage.** A main-process runtime dependency in
  `devDependencies` (missing from the asar at runtime), a renderer-only package
  in `dependencies` (tens of MB of bloat), or a native binary that needs
  `asarUnpack` and doesn't have it. These pass every local check and only fail
  in a built app.
- **Data loss or corruption.** Anything that can lose, overwrite, or fail to
  read `tasks/<id>/.instrument/{task.db,state.json}`, including schema or Zod
  shape changes that stop older tasks from loading.
- **Privacy leaks.** Prompts, agent messages, file contents, user file paths,
  API keys, or `.env` values reaching telemetry, logs, or the network.
- **Agent-turn correctness.** A tool, prompt, or message-assembly change that
  makes turns fail, hang, or silently drop state.

Naming, structure, refactor suggestions, doc wording, and test organization are
🟡 Nit at most, however strongly you feel about them.

## Cap the nits

Report at most five Nits per review. If you found more, say "plus N similar
items" in the summary rather than posting them inline.

## Do not report

- **Anything the checks already enforce.** `pnpm check-and-test` runs oxfmt
  formatting, ESLint + oxlint (including Tailwind class order and
  perfectionist sort order), `tsgo` types, cspell, markdownlint, knip, and the
  lockfile checks. If the only problem with a line is one of those, skip it.
- **`registry/`.** A read-only git submodule. Never suggest edits under it.
- **Generated and vendored files**: `apps/studio/src/client/routeTree.gen.ts`,
  `apps/studio/icons/.generated-hashes.json`, `pnpm-lock.yaml`, `patches/`, and
  `*.d.ts` environment shims.
- **Version bumps** in release commits.
- **Prose under `docs/`** unless the diff itself contradicts it. Do flag a doc
  that the same PR made wrong; do not review it for style, structure, or
  completeness.
- **Missing tests**, unless the change is to logic that the existing test
  projects can actually observe (see the last "Always check" item).

## Always check

- **The main/renderer boundary in `apps/studio`.** The renderer reaches the
  platform API, the filesystem, and the network only through main-process oRPC
  (`src/electron-main/rpc/routes/`). A renderer file importing `electron`, node
  built-ins, or the platform API directly is Important.
- **Error handling in `packages/workspace`.** Fallible logic returns a
  neverthrow `Result`; RPC handlers throw through `toORPCError`. Flag a new
  bare `throw` inside tool logic, and flag a `Result` whose error branch is
  discarded.
- **Persisted shapes stay backward compatible.** A changed Zod schema, column,
  or state key must still load a task written by the previous release, or ship
  a migration.
- **The word is `task`.** Copy, routes, RPC, telemetry, types, and on-disk
  paths call the user's unit of work a task — not a project, chat, or thread.
  (`session` and `project` are separate real concepts; the finding is a task
  renamed, not either of those used correctly.)
- **Session context can be 60 minutes stale.** Values derived from
  `agent.getMessages` are rebuilt only when stale, so a change that needs a
  value to be current in the next turn has to attach it per-turn instead.
- **No machine-local references.** Absolute paths like `/Users/...`, `~/code/...`,
  or `C:\...`, and names of sibling checkouts on one developer's disk, in code,
  comments, docs, or fixtures.
- **Tests that cannot fail.** jsdom has no layout engine and never fires
  `selectionchange`, so an assertion in `*.test.tsx` about measured layout,
  scrolling, caret position, or selection passes whether the code works or not
  — it belongs in `*.browser.test.tsx`. The same goes for a test that only
  asserts on its own mock.

## Verification bar

- Cite `file:line` in the source for any claim about what the code does.
  `AGENTS.md` and `docs/architecture/` describe intent, not what shipped —
  quoting them is not verification.
- Agent behavior (tools, prompts, skills, the sandbox, model-facing text)
  cannot be confirmed by reading a diff. If a finding about what the agent will
  do rests on inference rather than on code you traced, post it as a Nit
  phrased as a question, not as Important.
- Prefer one finding on the root cause over one per call site.

## Re-review convergence

On a re-review, post Important findings only, plus Nits on code the new commits
introduced. Do not re-raise a Nit from an earlier review, and do not open a new
style thread on a PR that is being iterated toward merge.

## Summary shape

Open the review body with a one-line tally, for example
`2 important, 4 nits`, followed by the packages touched. When there are no
correctness findings, say "No correctness issues" first and put the nits below
it.
