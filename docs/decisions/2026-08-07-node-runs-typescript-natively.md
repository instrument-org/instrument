# Node runs the agent's TypeScript, so the tsx and tsc shims are gone

Date: 2026-08-07

## Context

The bash sandbox exposed a `tsx` command that was neither tsx nor a TypeScript runtime. It ran `pnpm dlx jiti`, because real tsx carries an esbuild native binary we did not want to install per task, and jiti cannot evaluate a string. To support `-e`, the shim wrote the inline code to a `.ts-eval-<timestamp>-<rand>.ts` file in the current directory and ran that.

Three layers of indirection produced a trap. A script file resolves `node_modules` by walking up from the file, so `node work/skills/<source>/<name>/scripts/x.ts` run from the task root finds the skill's dependencies. The materialized `-e` file sits in the cwd instead, so the walk starts at the task root, where a skill's dependencies are not installed. The agent prompt meanwhile promised that "a script resolves its dependencies from its own folder either way" and forbade `cd`-ing into a script's folder, which is the only thing that made `-e` work. Two independent sessions on the same prompt hit `Cannot find module 'sharp'` at the same step, and both recovered by writing throwaway files into the skill folder.

## Decision

Delete the `tsx` shim. `node` runs the agent's TypeScript directly.

Delete `tsc` and the task template's `tsconfig.json` with it.

Add `tmp` to the file-index exclusions in `get-task-files.ts`.

## Why

Node 24 strips types with no flag, in files and in `-e` alike, and the runtime that executes agent scripts is Electron's bundled Node, verified at v24.15.0 for Electron 42.3.3. Measured against the shim it replaces:

| check | result |
| --- | --- |
| a real skill script (sharp + cac) under `node` | 0.16s |
| the same script under `pnpm dlx jiti` | 0.98s |
| the same comparison inside the sandbox | 73ms against 374-424ms |
| every executable script in the registry, `node --check` | 25 of 25 pass |

The registry needed no migration. Its relative imports already carry `.ts` extensions under `allowImportingTsExtensions`, which is exactly Node's requirement, and it contains no `enum`, `namespace`, decorator, or parameter property.

jiti also enabled the V8 compile cache and wrote its own transform cache into the task's tmp dir. On a one-line script that is 5 files and 1.19 MB where plain `node` writes nothing; in one real session it was 68 of the 88 file changes reported to the user, including a 1.9 MB blob. Removing the runner removes the cause, and excluding `tmp` closes the class.

`tsc` went with it because type stripping means annotations are never checked at runtime, so TypeScript in a task is documentation unless something checks it, and nothing did: its 42 appearances across the eval corpus collapse to three case families written to exercise `tsc` itself. Neither of the two real sessions invoked it, and the genuine bugs in those sessions (a misused `sharp.joinChannel`, a hash comparison over a truncated base64 prefix) both type-check clean. The task `tsconfig.json` had no reader left once `tsc` was gone, since Node ignores it.

## Consequences

- Erasable syntax only. `enum`, `namespace`, parameter properties, and `import x = require()` now fail at runtime, with a parse error that names the line. `--experimental-transform-types` is the escape hatch but prints an ExperimentalWarning on every run, so it is not enabled. Enforcement belongs in the registry's CI via `erasableSyntaxOnly`, where a real `tsc` already runs.
- Relative imports need their file extension, and a type-only import must be marked `type` or ESM will fail to bind it. Both are already the registry's house style.
- `node -e` still resolves modules from the current directory. That is real Node behavior rather than a shim artifact, and the command description and prompt now say so, but the trap is only fully removed by moving to a single task-level install.
- `pnpm exec tsx` and `pnpm tsx` no longer forward anywhere. `pnpm exec node` keeps its existing refusal, since node is not in `node_modules/.bin`.
- The `check` eval family is deleted. It tested `tsc` and nothing else.
- The Node version now rides with Electron upgrades.

## Implementation

- [Node command](../../packages/workspace/src/lib/shell-commands/node.ts)
- [Bash command registry](../../packages/workspace/src/lib/create-bash-env.ts)
- [File index exclusions](../../packages/workspace/src/lib/get-task-files.ts)
- [Agent prompt](../../packages/workspace/src/agents/main.ts)
