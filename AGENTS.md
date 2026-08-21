# Instrument Monorepo

pnpm monorepo for the Instrument desktop app platform.

- `apps/studio`: Electron desktop app (main product)
- `packages/workspace`: Core AI agents, workflow logic, and workspace management
- `packages/ai-gateway`: Model proxy (Hono app the workspace server mounts) plus the model discovery/identity library
- `packages/shared`: Types, constants, and utilities used everywhere
- `packages/shim-client`: Client-side runtime injected into user apps
- `packages/eslint-config`, `packages/typescript-config`: Shared tool config

## Product terminology

- The user's unit of work is a **task** everywhere: copy, code, routes, RPC, telemetry, types, tool names, and on-disk layout.
- On disk, tasks live under `tasks/<id>/` with `.instrument/{task.db,settings.json}`. One record file: what the app knows about the task at the top level, where the user left off under `state`.

## Local references

Never commit machine-local paths (`/Users/...`, `~/code/...`, `C:\...`) or names of sibling repos/checkouts on one dev's disk — not in code, docs, plans, commits, or PRs. Meaningless to others, goes stale when layout changes. Such pointers go in local notes, not shared history.

Sources outside this repo are reachable by name instead: `agent-reference.json` (shared) and `agent-reference.local.json` (gitignored, where machine paths go) declare them, and `agent-reference status` lists them.

## Registry Submodule

**NEVER edit `registry/`.** It is the `instrument-org/skills` git submodule. Read freely; do not create, edit, or delete files there.

## TypeScript

- Avoid casts. Prefer `satisfies`; use `as` only for genuinely different types (e.g. unknown payloads), and say why.
- Reuse existing types/interfaces rather than redefining per file. Prefer short inline non-exported types.
- Use `radashi` for common lodash-style functions.
- Do not run `tsc`; use built-in diagnostics or `tsgo`.

## Tailwind

Tailwind v4 scale utilities (`pt-17`, `gap-11`, `w-17`, etc.) are valid (4px x n). Prefer them over arbitrary `[...]` values.

## Zod

Prefer `z.output` over `z.infer` for type inference.

## React

- React Compiler is set up for Studio, so basic `memo`, `useMemo`, and `useCallback` are unnecessary.
- Avoid interfaces for component props; use inline types.

## Monorepo checks (Turbo)

Run lint/types from **repo root** through Turbo for caching. Avoid package-loop `cd` for `check:lint` / `check:types`. `turbo` is not always on PATH; use `pnpm exec turbo run …` (or root scripts that invoke turbo).

- `pnpm exec turbo run check:types check:lint` — all packages, or `--filter=@instrument-org/{workspace,studio}` for one
- `pnpm check-and-test` — full local check (includes spelling, format, etc.)
- `pnpm check-and-test:ci` — what CI runs (omits pedantic checks that don't affect correctness)
- `pnpm turbo:fix:lint` — fix lint

`check:lint` / `fix:lint` run both ESLint (syntactic rules: perfectionist, react-compiler, regexp, yml/jsonc, turbo) and `oxlint --type-aware` (all TypeScript type-aware rules via tsgolint, plus Tailwind class rules). There is no typed linting in the ESLint config, so it is fast.

A format hook (`.claude/settings.json`, `@instrument-org/agent-hooks`) runs oxfmt on every file you Edit/Write, then oxfmt + `oxlint --fix` + `eslint --fix` on Stop over the files that session edited. Anything ESLint could not fix blocks the turn and comes back to you to fix in context. So: expect files to change after you write them, never hand-format or hand-fix order-only and auto-fixable lint (including Tailwind class order), and don't run `check:lint` proactively to find what the hook is about to hand you anyway.

What the hook does not cover: type errors, `oxlint --type-aware` problems that `--fix` can't resolve, and any file written by something other than Edit/Write (a heredoc or `sed -i` is untracked, so it is neither formatted nor linted). Run `check:types` yourself when a change can move types: a signature, a schema, a prop, the shape of data flowing through. Skip it when a change cannot: className and CSS edits, copy, Markdown.

## Key catalog versions

`package.json` files show `"catalog:"` instead of version numbers. Real versions are in `pnpm-workspace.yaml` under `catalog:`. The ones where a stale assumption changes the code you write:

- **React** 19.2 / **react-dom** 19.2
- **TypeScript** 5.9 (also available as `@typescript/native-preview` 7.x via `tsgo`)
- **Zod** 4.x
- **Vite** 8.x (Rolldown/Oxc) / **Vitest** 4.x
- **AI SDK** 6.x
- **better-auth** 1.6.x
- **pnpm** 11.10.0 (`packageManager`) / **Node** >=24.15.0 (`engines`)

## Package management

- `pnpm` CLI (`install`, `add`, `remove`, `why`, etc.): outside sandbox (full permissions). pnpm links from the global store; sandbox isolation blocks that path, so the workspace no longer matches a normal local install.
- `pnpm test` / `pnpm check-and-test`: sandbox OK.

## Worktrees

After a manual `git worktree add`, run `.claude/hooks/worktree-setup.sh <path-to-worktree>`: copies the gitignored env files (required to boot Studio), inits `registry/`, installs deps. Idempotent. Hooks do this automatically only for sessions started inside a worktree or via EnterWorktree.

Multiple worktrees can run Studio at once: dev skips the single-instance lock, and the servers an instance binds fall back past the ports another one holds. Start one with `studio-drive.mjs boot --purpose <purpose>` (`studio-chrome-devtools` skill) rather than `pnpm dev` directly, so a checkout that already has an instance reuses it and the CDP port comes from the checkout path instead of from a guess. They all share one dev userData dir, so two instances are also two writers of one set of preferences and one workspace; `boot --purpose <purpose> --workspace <fixture>` gets a disposable one instead.

## Tests

- Run one file or a whole package with `cd packages/<name> && pnpm test run [path/to/file.test.ts]` (same shape in `apps/studio`).
- Prefer `toMatchInlineSnapshot` so expected output stays visible in the test file. Generate it empty and let the run fill it in.
- Use `it.each` for repetitive cases.

## Repository knowledge base

Durable, versioned docs are the system of record; prefer them over chat/history. Keep them evergreen and safe to share: leave out secrets and anything tied to one machine, person, or moment.

- `docs/README.md`: the knowledge-base index and provenance.
- `docs/architecture/` — evergreen maps of a subsystem or domain and how it layers together, edited in place as the code changes. One file per subsystem.
- `docs/findings/` — non-obvious issues, what we tried, what might resolve them later. One file per finding.
- `docs/plans/` — execution plans for non-trivial work (`active/` vs `completed/`). One file per plan.
- `docs/decisions/` — why we chose one approach over another, dated. One file per decision.
- `docs/changes/`: dated, screenshot-backed summaries of user-facing changes for design follow-up and possible changelog input.

## Additional guidance

- `REVIEW.md` — Repo-specific code review calibration.
- `.agents/skills/validate-changes/SKILL.md` — **How to check your work.** The ways to run this product (sandbox shell, real agent across models, the app), what each one can and cannot tell you, and which to reach for. Read this before concluding a change works.
- `.agents/skills/instrument-commit-message/SKILL.md` — This repo's commit scopes and real examples from the history.
- `.agents/setup.md` — Prerequisites before first `pnpm install` / `./scripts/setup.sh`.
- `.agents/env.md` — Environment variables for Studio and workspace.
- `docs/architecture/system-overview.md` — Top-level map: packages/layering, main-vs-renderer runtime topology, on-disk layout, and how an agent turn flows. Start here.
- `docs/architecture/ai-gateway.md` — Model access: the mounted provider-proxy Hono app plus the model-discovery/identity library consumed by workspace and studio.
- `docs/architecture/agent-sandbox.md` — How agent tools are contained (path-scoped file I/O, just-bash virtual FS, agent-browser allowlist, real-binary escape hatches). Not OS-level sandboxing.
- `docs/architecture/bash-sandbox-mounts-and-native-binaries.md` — Design constraints and known quirks of the `/task` + `/skills` + `/mnt` mount layout and the virtual↔host path bridge.
- `docs/architecture/just-bash-upstream.md` — Which `just-bash` build we consume, every patch and agent-facing workaround we carry because of an upstream gap, what has to be true before each can go, and our open upstream PRs. Read before adding a prompt line that steers the agent around sandbox behavior.
- `docs/architecture/asset-origin.md` — The per-task `assets.<taskId>` HTTP origin: how the host header routes it, why its path space is the virtual FS path space, who builds its URLs, its cache policy and containment, and what it does not authenticate.
- `docs/architecture/in-app-browser.md` — The per-task browser: the renderer-owned `<webview>` pool, paint-host vs visible, the CDP path from `agent-browser` to the guest, and what the panel may do that the agent may not.
- `docs/architecture/responsive-layout.md` — Why viewport breakpoints are the wrong proxy for layout width in Studio (UI zoom + resizable sidebar), the `@container/app-content` shell container, and the unit rules for sizing portalled content under zoom.
- `docs/architecture/studio-in-the-browser.md` — `apps/studio/web/`: Studio's real renderer served as a plain web page with the Electron boundary replaced by fixtures, for development only. How to add a fixture, and the live-query rules that make one work.
- `docs/architecture/auto-updater.md` — How Studio finds, stages, and installs a build: the pure-reducer / port-seam / wiring split, channel selection, and why the build offered and the build installed can diverge.
- `.agents/cloud-dev.md` — Headless/CI dev: `NO_SANDBOX`, shim + Studio startup, CDP port 48160, Xvfb, pnpm checks.
- `apps/studio/AGENTS.md` — Electron deps vs devDeps, React 19 + TanStack Router + oRPC patterns, where client/main/RPC code lives.
- `packages/workspace/AGENTS.md` — RPC routes, tools/agents layout, workspace server, XState machines, neverthrow + Zod tool conventions.
