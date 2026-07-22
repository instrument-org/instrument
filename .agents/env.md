# Environment variables

Copy example files to local env files before running Studio or workspace logic. Do not commit secrets.

## Studio (`apps/studio/.env.local`)

Copy from `apps/studio/.env.local.example`. Loaded by electron-vite for the main and renderer processes.

| Variable                          | Required | Description                                                                                                                                      |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MAIN_VITE_APP_API_BASE_URL`      | yes      | Base URL for the Instrument platform API (accounts, billing, gateway). Local dev: `http://localhost:49100` with the `internal` API repo running. |
| `MAIN_VITE_GOOGLE_CLIENT_ID`      | yes      | Google OAuth client ID for sign-in.                                                                                                              |
| `MAIN_VITE_GOOGLE_CLIENT_SECRET`  | yes      | Google OAuth client secret for sign-in.                                                                                                          |
| `MAIN_VITE_APP_REGISTRY_DIR_PATH` | no       | Override path to the skills `registry/` folder during dev. Default uses the repo submodule at `registry/`.                                       |
| `VITE_DEBUG_TELEMETRY`            | no       | When `true`, enables extra telemetry logging. Default `false`.                                                                                   |
| `VITE_POSTHOG_API_HOST`           | no       | PostHog ingest host when telemetry is configured.                                                                                                |
| `VITE_POSTHOG_API_KEY`            | no       | PostHog project API key when telemetry is configured.                                                                                            |

`apps/studio/.env.development` ships committed defaults for non-secret dev settings; `.env.local` overrides and holds secrets.

Linked worktrees copy local env files and normalize relative registry overrides to absolute paths based on the source env file.
