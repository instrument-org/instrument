# Instrument Monorepo

pnpm monorepo for the Instrument desktop app platform.

- `apps/studio`: Electron desktop app (main product)
- `packages/workspace`: Core AI agents, workflow logic, and workspace management
- `packages/shim-client`: Client-side runtime injected into user apps

## Readability

- Wrap long lines when it helps scan code, prompts, or docs.

## Product terminology

- User/agent-facing copy calls the user's unit of work a **task**.
- Internal code may still say `project` for routes, RPC, telemetry, types,
  folders, and tool names. Keep those unless migrating the API/data model.

## Registry Submodule

**NEVER edit `registry/`.** It is the `instrument-org/skills` git submodule. Read freely; do not create, edit, or delete files there.

## TypeScript

- No non-null assertions (`!`); use type guards or optional chaining.
- Avoid casts. If needed, explain why. Prefer `satisfies`; use `as` only for different-type assertions, e.g. unknown payloads.
- Avoid `any`; never use `as any`.
- Reuse existing types/interfaces; avoid per-file redefinitions.
- Avoid optional props/properties unless needed.
- Kebab-case filenames.
- Prefer named exports.
- No JSX section comments like `{/* Header */}<Header />`.
- Prefer object params for many or identical params: `({ a, b }: { a: number, b: number }) => number`.
- Do not run `tsc`; use built-in diagnostics or `tsgo`.
- Perfectionist/import-x sort objects, interfaces, types, imports, etc. Ignore order-only lint errors; auto-fix handles them.
- `lib`: `es2023`, `DOM`, `DOM.Iterable`; modern features OK.
- Use `radashi` for common lodash-style functions.
- Prefer short inline non-exported type declarations.
- Avoid `Array#reduce()`; prefer `.map`, `.filter`, or `for...of`.
- Omit return types unless needed.

## Tailwind

- Use `size-` over `w-` and `h-` when width and height are the same.
- Use `gap-x-` or `gap-y-` over `space-x` or `space-y` for gap.
- Tailwind v4 scale utilities (`pt-17`, `gap-11`, `w-17`, etc.) are valid (4px x n). Prefer over arbitrary `[...]`.

## Zod

- Prefer `z.output` over `z.infer` for type inference.

## React

- Avoid interfaces for component props; use inline types.
- Avoid `useEffect` when logic can be declarative.
- React Compiler is set up for Studio; basic `memo`, `useMemo`, and `useCallback` are unnecessary.
- Ignore "Incorrect class order" errors from eslint-plugin-better-tailwindcss. They are auto-fixed and do not need manual correction.

## Monorepo checks (Turbo)

Run lint/types from **repo root** through Turbo for caching. Avoid package-loop `cd` for `check:lint` / `check:types`.

`turbo` is not always on PATH; use `pnpm exec turbo run …` (or root scripts
that invoke turbo).

- `pnpm exec turbo run check:types check:lint` — all packages
- `pnpm exec turbo run check:types check:lint --filter=@instrument-org/workspace`
- `pnpm exec turbo run check:types check:lint --filter=@instrument-org/studio`
- `pnpm check-and-test` — full CI
- `pnpm turbo:fix:lint` — fix lint

Single test file: `cd packages/<name> && pnpm test run <file>` or
`cd apps/studio && pnpm test run <file>`.

## Key catalog versions

`package.json` files show `"catalog:"` instead of version numbers. Real versions
are in `pnpm-workspace.yaml` under `catalog:`. Critical ones:

- **React** 19.2 / **react-dom** 19.2
- **TypeScript** 5.9 (also available as `@typescript/native-preview` 7.x via `tsgo`)
- **Zod** 4.x
- **Vite** 7.x / **Vitest** 4.x
- **AI SDK** 6.x
- **better-auth** 1.2.x

## Package management

- `pnpm` CLI (`install`, `add`, `remove`, `why`, etc.): outside sandbox (full
  permissions). pnpm links from the global store; sandbox isolation blocks that
  path, so the workspace no longer matches a normal local install.
- `pnpm test` / `pnpm check-and-test`: sandbox OK.

## Tests

- Use `it.each` for testing repetitive cases.
- Generate empty `toMatchInlineSnapshot` and allow the test run to fill it in.
- Prefer `toMatchInlineSnapshot`; keep expected output visible in the test file.
- Run a specific test file: `cd packages/<name> && pnpm test run <path/to/file.test.ts>`.
- Run all tests in a package: `cd packages/<name> && pnpm test run`.

## Additional guidance

- `.agents/setup.md` — Prerequisites before first `pnpm install` / `./scripts/setup.sh`.
- `.agents/env.md` — Environment variables for Studio and workspace.
- `.agents/sandbox.md` — How agent tools are contained (path-scoped file I/O, just-bash virtual FS, agent-browser allowlist, real-binary escape hatches). Not OS-level sandboxing.
- `.agents/cloud-dev.md` — Headless/CI dev: `NO_SANDBOX`, shim + Studio startup, CDP port 48160, Xvfb, pnpm checks.
- `apps/studio/AGENTS.md` — Electron deps vs devDeps, React 19 + TanStack Router + oRPC patterns, where client/main/RPC code lives.
- `.agents/skills/studio-dev-logs/SKILL.md` — Read NDJSON logs written to `apps/studio/.logs/` on each dev boot.
- `packages/workspace/AGENTS.md` — RPC routes, tools/agents layout, workspace server, XState machines, neverthrow + Zod tool conventions.
