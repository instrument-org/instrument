# Local setup prerequisites

What a machine needs before `pnpm studio` (README) can run.

## Tooling

- Node and pnpm at the versions the root `package.json` names (`engines`, `packageManager`). `corepack enable` provides the pnpm.
- On a Mac, the Xcode Command Line Tools (`xcode-select --install`). The dev build compiles the Mac bridge (`apps/studio/native/mac-helper`) for this Mac's architecture with them; Xcode itself is needed only for a universal package build.

## Running Studio

- `pnpm studio` from the root, or VS Code/Cursor **Run and Debug → 🐛 Studio**. Both take `scripts/prepare.ts` first, which makes `apps/studio/.env.local` from its example, checks out `registry/`, installs dependencies, and builds the Mac bridge when any of those is missing or stale. It is idempotent and takes about a second when nothing changed.
- `pnpm sync` pulls `main` (it refuses on another branch) and then prepares the same way.
- A first launch on a fresh machine: `ELECTRON_USER_DATA_DIR=<empty dir> pnpm studio`.
- **Platform API** (auth, billing, models): `MAIN_VITE_APP_API_BASE_URL` in `apps/studio/.env.local` starts out as production, so sign-in works with no setup. To work on the API too, run `pnpm api` at the root of the `internal` repo and set it to **<http://localhost:49100>**; while that server is down, sign-in and gateway calls fail.

Environment variables: [.agents/env.md](env.md).
