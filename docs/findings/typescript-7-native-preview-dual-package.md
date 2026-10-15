# TypeScript 7 (tsgo): why we ran a dual TypeScript setup

**Status:** resolved, checked 2026-10-15. The repo runs one TypeScript, the `typescript` 7.x package, and `@typescript/native-preview` is gone.

## What it was

Before TypeScript 7 shipped as `typescript` 7.0, the native Go compiler ("tsgo") came only as `@typescript/native-preview`, so the repo carried both: the preview ran every `check:types` (`tsgo --noEmit`), and the classic JavaScript `typescript` 5.x stayed for tools that called its compiler API, chiefly `typescript-eslint` and the ESLint plugins built on it. One catalog entry cannot be both 5.x and 7.x, which is why the second package name existed.

## What changed

- ESLint, `typescript-eslint` and those plugins were dropped for oxlint (4fd1acd37), which left no installed package calling the classic compiler API. The remaining peers on `typescript` (`valibot`, `msw`, `@t3-oss/env-core`, `vue`) are optional type peers.
- The catalog's `typescript` is 7.x, `check:types` is `tsc --noEmit`, and `tsc` is the native compiler.
- `typescript` 7.0 has no compiler JS API: `require("typescript")` returns only its version, and the API it does ship is under `typescript/unstable/*`. A tool that needs the 5.x API cannot run against the catalog entry; a dependency that bundles or pins its own 5.x (as `just-bash` does) is unaffected.
- What uses it today: `tsc` for `check:types`; Vitest's typecheck mode, which spawns `tsc` and parses its output; and the editor. Type-aware lint runs on the compiler inside `oxlint-tsgolint`, independent of this package. knip, Vite and tsx do not load TypeScript.

## Editor

VS Code reaches TypeScript 7 through the TypeScript 7 extension (`TypeScriptTeam.native-preview`) and `js/ts.experimental.useTsgo`. The extension looks for a workspace compiler only under `node_modules/@typescript/native-preview`, so `js/ts.tsdk.path` points it at `node_modules/typescript`; without it the extension runs the compiler it bundles. 7.0 ships no `tsserver`, so the old `typescript.tsdk` pointing at `typescript/lib` has nothing to load.

Reference: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
