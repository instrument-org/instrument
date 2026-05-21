# Instrument Monorepo

Pnpm monorepo for the Instrument desktop app platform.

- `apps/studio`: Electron desktop app (main product)
- `packages/workspace`: Core AI agents, workflow logic, and workspace management
- `packages/shim-client`: Client-side runtime injected into user apps

## Readability

- Prefer wrapping long lines when it makes code, prompts, or docs easier to scan.

## Registry Submodule

**NEVER make changes to files inside the `registry/` folder.** It is a git submodule (`instrument-org/skills`) managed independently. Read from it freely, but do not edit, create, or delete any files within it.

## TypeScript

- NEVER use non-null assertions (`!`). This is forbidden. Always use proper type guards or optional chaining instead.
- Avoid casting types unless necessary. If you do cast, you must add a comment explaining why.
- Prefer `satisfies` over `as`; use `as` only to assert a different type (e.g. unknown payloads).
- Avoid `any` and NEVER use `as any`.
- Avoid redefining types and interfaces in every file, if possible, use an existing type or interface.
- Avoid making component props and object properties optional unless necessary.
- We use kebab case for filenames.
- We use non-default exports whenever possible.
- NEVER add comments for sections of JSX like `{/* Header */}<Header />`.
- Prefer objects for functions with many parameters.
- Don't run `tsc` to check for type errors, use your built-in diagnostics tool.
- Ignore import sort order linter errors (e.g. "Expected X to come before Y"). They are auto-fixed and do not need manual correction.
- `"lib": ["es2023", "DOM", "DOM.Iterable"]` is set, so you can use modern features.
- The `radashi` import is installed. Use it for common lodash-style functions.
- Prefer inline type declarations when they are short and not exported.
- Prefer object types for functions with identical parameters, e.g. `({ a, b }: { a: number, b: number }) => number` instead of `(a: number, b: number) => number`.
- `Array#reduce()` usually results in hard-to-read and less performant code. Instead, prefer `.map`, `.filter`, or a `for...of` loop.
- Don't define return types unless necessary.
- The `tsgo` binary is available in all packages. Use in the shell in place of `tsc`.

## Tailwind

- Use `size-` over `w-` and `h-` when width and height are the same.
- Use `gap-x-` or `gap-y-` over `space-x` or `space-y` for gap.
- Tailwind v4 scale utilities (`pt-17`, `gap-11`, `w-17`, etc.) are valid (4px x n). Prefer over arbitrary `[...]`.

## Zod

- Prefer `z.output` over `z.infer` for type inference.

## React

- Avoid using interfaces for component props, use inline types instead.
- Avoid `useEffect` whenever possible in favor of making logic declarative.
- React Compiler is setup for the Studio, so basic memoization like memo, useMemo, and useCallback are not needed.
- Ignore "Incorrect class order" errors from eslint-plugin-better-tailwindcss. They are auto-fixed and do not need manual correction.

## Tests

- Use `it.each` for testing repetitive cases.
- Generate empty `toMatchInlineSnapshot` and allow the test run to fill it in.
- Prefer `toMatchInlineSnapshot` over `toMatchSnapshot`. We prefer to see what's being tested clearly in the same file to avoid mistakes.
- Run a specific test file: `cd packages/<name> && pnpm test run <path/to/file.test.ts>`.
- Run all tests in a package: `cd packages/<name> && pnpm test run`.

## Additional guidance

- `.agents/sandbox.md` — How agent tools are contained (path-scoped file I/O, just-bash virtual FS, agent-browser allowlist, real-binary escape hatches). Not OS-level sandboxing.
- `.agents/cloud-dev.md` — Headless/CI dev: `NO_SANDBOX`, shim + Studio startup, CDP port 48160, Xvfb, pnpm checks.
- `apps/studio/AGENTS.md` — Electron deps vs devDeps, React 19 + TanStack Router + oRPC patterns, where client/main/RPC code lives.
- `packages/workspace/AGENTS.md` — RPC routes, tools/agents layout, workspace server, XState machines, neverthrow + Zod tool conventions.
