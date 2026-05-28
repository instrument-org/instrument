# Local setup prerequisites

Before the README setup flow (`pnpm install`, `./scripts/setup.sh`,
`pnpm run dev:studio`).

## Tooling

- Node **>=24.14.1** (root `package.json` `engines`)
- **pnpm@10.33.0** (`packageManager` field);
  `corepack enable && corepack prepare pnpm@10.33.0 --activate`

## Repository

- Clone with submodules (`registry/` skills):
  `git clone --recurse-submodules …` or `git submodule update --init` after clone.
- `./scripts/setup.sh` calls `scripts/sync.sh`, which requires the **`main`**
  branch and network for `git pull`. On a feature branch, copy
  `apps/studio/.env.local` from `.env.local.example` and run `pnpm install`
  instead.

## Running Studio

- `pnpm run dev:studio` (README) or VS Code/Cursor **Run and Debug → Studio**
  after setup.
- **Platform API** (auth, billing, models): run the separate `internal` API at
  **<http://localhost:49100>** so `MAIN_VITE_APP_API_BASE_URL` in
  `apps/studio/.env.local` resolves. The Electron shell can start without it;
  sign-in and gateway calls fail until the API is up.

Environment variables: [.agents/env.md](env.md).
