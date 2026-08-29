# Environment variables

Copy example files to local env files before running Studio or workspace logic. Do not commit secrets.

## Studio (`apps/studio/.env.local`)

Copy from `apps/studio/.env.local.example`. Loaded by electron-vite for the main and renderer processes.

| Variable                          | Required | Description                                                                                                                                             |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAIN_VITE_APP_API_BASE_URL`      | yes      | Base URL for the Instrument platform API (accounts, billing, gateway). Local dev: `http://localhost:49100` with the `internal` API repo running.        |
| `MAIN_VITE_GOOGLE_CLIENT_ID`      | no       | Google OAuth client ID for sign-in. `.env.development` ships the shared dev value; sign-in fails without one.                                           |
| `MAIN_VITE_GOOGLE_CLIENT_SECRET`  | no       | Google OAuth client secret for sign-in; sourced like the client ID.                                                                                     |
| `MAIN_VITE_APP_REGISTRY_DIR_PATH` | no       | Path to the skills registry. `.env.development` points it at a sibling skills checkout; unset, the app falls back to the repo submodule at `registry/`. |
| `MAIN_VITE_USE_BUILT_SHIM_CLIENT` | no       | `true` serves `packages/shim-client/dist` instead of the shim dev server.                                                                               |
| `VITE_DEBUG_TELEMETRY`            | no       | When `true`, enables extra telemetry logging. Default `false`.                                                                                          |
| `VITE_POSTHOG_API_HOST`           | no       | PostHog ingest host when telemetry is configured.                                                                                                       |
| `VITE_POSTHOG_API_KEY`            | no       | PostHog project API key when telemetry is configured.                                                                                                   |

`apps/studio/.env.development` ships committed defaults, including the shared dev Google OAuth client; `.env.local` overrides them and holds anything that must stay out of the repo.

Linked worktrees copy local env files and normalize relative registry overrides to absolute paths based on the source env file.

Dev and agent runtime knobs (`ELECTRON_USER_DATA_DIR`, `DISABLE_DEV_RELAUNCH`, `REMOTE_DEBUGGING_PORT`, `SKIP_ONBOARDING`, `INSTRUMENT_OZONE_PLATFORM`, and friends) are not env-file settings: they are declared in `turbo.json` and documented where they are used (`apps/studio/AGENTS.md`, [cloud-dev.md](cloud-dev.md), the `studio-chrome-devtools` skill).

## Workspace (`packages/workspace/.env`)

Copy from `packages/workspace/.env.example`. Read by workspace scripts and the eval harness (`scripts/lib/env.ts`); the app itself gets provider credentials from Studio's stores instead.

All optional: the provider keys `APP_ANTHROPIC_API_KEY`, `APP_CEREBRAS_API_KEY`, `APP_GOOGLE_API_KEY`, `APP_GROQ_API_KEY`, `APP_OPENAI_API_KEY`, `APP_OPENROUTER_API_KEY`, `APP_ZAI_API_KEY` (at least one for anything that calls a model), plus `APP_AI_GATEWAY_API_KEY` and `APP_REGISTRY_DIR_PATH` (registry override for workspace-only runs).
