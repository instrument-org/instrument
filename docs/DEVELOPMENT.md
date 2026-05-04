# Development

## Prerequisites

- **Node** version per root `package.json` `engines` (>= 24.14.1; `devEngines` may pin a specific patch).
- **pnpm** version in `packageManager` at the repo root.

## First-time setup

```bash
pnpm install
./scripts/setup.sh
```

## Run Studio locally

```bash
pnpm run dev:studio
```

This runs Turbo `dev` for `@instrument-org/studio` and `@instrument-org/shim-client` together so the desktop app and shim line up.

## Common repo scripts

From the repository root (`package.json`):

| Script | Purpose |
| ------ | ------- |
| `pnpm run check-and-test` | Full validation pipeline (format, lint, types, spelling, builds, tests) |
| `pnpm run fix:format` | Apply Prettier |
| `pnpm run fix:lint` | ESLint with fixes |
| `pnpm test` | Root Vitest |

Package-specific scripts live in each `package.json` (for example `apps/studio`, `packages/workspace`).

## Turborepo

`turbo.json` defines task dependencies. Studio build tasks may depend on building `shim-client` first.

## Registry submodule

Updating pulled skills uses automation such as `pnpm run scripts:update-registry` when maintainers refresh the submodule; do not hand-edit files under `registry/`.
