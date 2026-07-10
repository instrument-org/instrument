# TypeScript 7 (tsgo): why we run a dual TypeScript setup

**Status:** open — waiting on upstream. Last updated 2026-07-10.

## What

The repo type-checks with TypeScript 7 (the native Go port, "tsgo") but keeps
the classic JavaScript-based `typescript` package installed alongside it:

- `@typescript/native-preview` (tsgo) runs every `check:types` (`tsgo
--noEmit`) and backs type-aware linting (`oxlint --type-aware` via
  `oxlint-tsgolint`).
- `typescript` (catalog `5.9.x`) stays because JS tooling calls the classic
  TypeScript compiler API, which tsgo does not yet expose.

The editor gets tsgo through the `TypeScriptTeam.native-preview` VS Code
extension plus `js/ts.experimental.useTsgo` (see `.vscode/settings.json` and
`.vscode/extensions.json`).

## Why the classic `typescript` stays

TypeScript 7 does not yet ship a stable programmatic API, so any tool that
imports `typescript` to parse or analyze code still needs the 5.x package.
Every installed package that peer-resolves against classic `typescript` is
lint/test tooling:

- `typescript-eslint` and its internals (`@typescript-eslint/parser`,
  `typescript-estree`, `type-utils`, `project-service`, `tsconfig-utils`,
  `utils`) — the primary consumer
- `ts-api-utils`, `ts-declaration-location`, `eslint-plugin-n`,
  `eslint-plugin-perfectionist`, `@vitest/eslint-plugin`

`valibot`, `msw`, and `@t3-oss/env-core` list `typescript` only as an optional
types peer and do not force the version.

Because `typescript` is a single catalog entry, it cannot be both 5.x and 7.x
at once. The separate `@typescript/native-preview` package name is what lets
tsgo run beside classic `typescript` without a version collision — it is not
redundant.

## Migration triggers

Collapse the dual setup only when these clear:

1. **npm package** — when `typescript-eslint` (and the rest of the ESLint /
   Vitest plugin ecosystem above) supports the TypeScript 7 API: bump the
   single `typescript` catalog entry to `7.x`, drop `@typescript/native-preview`
   from every package.json, and switch `check:types` back to `tsc --noEmit`.
   Mainline nightlies resume under the `typescript@next` tag.
2. **VS Code extension** — when VS Code ships built-in TypeScript 7 support
   (announced as "coming weeks" at 7.0): drop the
   `TypeScriptTeam.native-preview` recommendation from `.vscode/extensions.json`
   and the `js/ts.experimental.useTsgo` settings.

Reference: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
