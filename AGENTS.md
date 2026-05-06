# Agents

## Cursor Cloud specific instructions

### Environment

- **Node.js >= 24.14.1** required (uses `node:sqlite` built-in). Install from NodeSource 24.x repo.
- **pnpm 10.33.0** via `corepack enable && corepack prepare pnpm@10.33.0 --activate`.
- After `pnpm install`, run `./scripts/setup.sh` or manually: copy `apps/studio/.env.local.example` to `apps/studio/.env.local` and `git submodule update --init --recursive`.

### Running the Electron app (headless)

- Electron requires `NO_SANDBOX=1` env var when running as root (common in CI/cloud).
- Turbo does **not** reliably forward `NO_SANDBOX` to child processes. Run dev services directly instead of via `pnpm dev:studio`:
  1. `cd packages/shim-client && pnpm dev` (Vite on port 48350)
  2. `cd apps/studio && NO_SANDBOX=1 pnpm dev` (Electron + renderer on port 5173, workspace server on port 48300)
- Ensure `DISPLAY=:1` is set (Xvfb should already be running on `:1`).
- D-Bus errors in the console are harmless in headless environments.

### Lint / Type-check / Test

- `pnpm check:types` -- uses `tsgo --noEmit` (native TS type checker)
- `pnpm check:lint` -- ESLint with `--max-warnings 0`
- `pnpm test -- --run` -- Vitest (54 test files, ~605 tests)
- Full pre-push suite: `pnpm check-and-test` (runs all checks via turbo)

### Key ports

| Port  | Service                |
|-------|------------------------|
| 5173  | Renderer Vite dev      |
| 48300 | Workspace apps server  |
| 48350 | Shim-client Vite dev   |
| 48160 | Electron debug port    |

### Notes

- The `registry/` folder is a **read-only** git submodule. Never edit files inside it.
- The Platform API (port 49100) is external and not in this repo; auth/billing features are unavailable without it, but the app runs fine for local dev.
- `pnpm-workspace.yaml` has `allowBuilds` for native packages; never run `pnpm install` interactively to approve builds.
