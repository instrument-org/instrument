# Environment variables

Copy example files to local env files before running Studio or workspace logic. Do not commit secrets.

## Studio (`apps/studio/.env.local`)

Copy from `apps/studio/.env.local.example`. Loaded by electron-vite for the main and renderer processes.

| Variable                          | Required | Description                                                                                                                                                                         |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAIN_VITE_APP_API_BASE_URL`      | yes      | Base URL for the Instrument platform API (accounts, billing, gateway). Local dev: `http://localhost:49100` with the `internal` API repo running.                                    |
| `MAIN_VITE_GOOGLE_CLIENT_ID`      | no       | Google OAuth client ID for sign-in. Not validated as required, but sign-in fails without one; the committed example leaves it empty, so the value arrives through a local env file. |
| `MAIN_VITE_GOOGLE_CLIENT_SECRET`  | no       | Google OAuth client secret for sign-in; sourced like the client ID.                                                                                                                 |
| `MAIN_VITE_APP_REGISTRY_DIR_PATH` | no       | Override path to the skills registry. Unset, the app falls back to the repo submodule at `registry/`.                                                                               |
| `MAIN_VITE_USE_BUILT_SHIM_CLIENT` | no       | `true` serves `packages/shim-client/dist` instead of the shim dev server.                                                                                                           |
| `VITE_DEBUG_TELEMETRY`            | no       | When `true`, enables extra telemetry logging. Default `false`.                                                                                                                      |
| `VITE_POSTHOG_API_HOST`           | no       | PostHog ingest host when telemetry is configured.                                                                                                                                   |
| `VITE_POSTHOG_API_KEY`            | no       | PostHog project API key when telemetry is configured.                                                                                                                               |

`apps/studio/.env.development` is gitignored and machine-local, but electron-vite loads it in dev when present, so values there (OAuth credentials, a registry override) act as defaults underneath `.env.local`. Nothing in the repo ships it: a fresh clone has only what setup copies from `.env.local.example`.

Linked worktrees copy local env files and normalize relative registry overrides to absolute paths based on the source env file.

Dev and agent runtime knobs (`ELECTRON_USER_DATA_DIR`, `DISABLE_DEV_RELAUNCH`, `REMOTE_DEBUGGING_PORT`, `SKIP_ONBOARDING`, `INSTRUMENT_OZONE_PLATFORM`, and friends) are not env-file settings: they are declared in `turbo.json` and documented where they are used (`apps/studio/AGENTS.md`, [cloud-dev.md](cloud-dev.md), the `studio-chrome-devtools` skill).

## Workspace (`packages/workspace/.env`)

Copy from `packages/workspace/.env.example`. Read by workspace scripts and the eval harness (`scripts/lib/env.ts`); the app itself gets provider credentials from Studio's stores instead.

All optional: the provider keys `APP_ANTHROPIC_API_KEY`, `APP_CEREBRAS_API_KEY`, `APP_GOOGLE_API_KEY`, `APP_GROQ_API_KEY`, `APP_OPENAI_API_KEY`, `APP_OPENROUTER_API_KEY`, `APP_ZAI_API_KEY` (at least one for anything that calls a model), plus `APP_AI_GATEWAY_API_KEY` and `APP_REGISTRY_DIR_PATH` (registry override for workspace-only runs).
