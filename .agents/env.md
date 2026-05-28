# Environment variables

Copy example files to local env files before running Studio or workspace logic.
Do not commit secrets.

## Studio (`apps/studio/.env.local`)

Copy from `apps/studio/.env.local.example`. Loaded by electron-vite for the
main and renderer processes.

| Variable                          | Required | Description                                                                                                                                      |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MAIN_VITE_APP_API_BASE_URL`      | yes      | Base URL for the Instrument platform API (accounts, billing, gateway). Local dev: `http://localhost:49100` with the `internal` API repo running. |
| `MAIN_VITE_GOOGLE_CLIENT_ID`      | yes      | Google OAuth client ID for sign-in.                                                                                                              |
| `MAIN_VITE_GOOGLE_CLIENT_SECRET`  | yes      | Google OAuth client secret for sign-in.                                                                                                          |
| `MAIN_VITE_APP_REGISTRY_DIR_PATH` | no       | Override path to the skills `registry/` folder during dev. Default uses the repo submodule at `registry/`.                                       |
| `VITE_DEBUG_TELEMETRY`            | no       | When `true`, enables extra telemetry logging. Default `false`.                                                                                   |
| `VITE_POSTHOG_API_HOST`           | no       | PostHog ingest host when telemetry is configured.                                                                                                |
| `VITE_POSTHOG_API_KEY`            | no       | PostHog project API key when telemetry is configured.                                                                                            |

`apps/studio/.env.development` ships committed defaults for non-secret dev
settings; `.env.local` overrides and holds secrets.

## Workspace (`packages/workspace/.env`)

Copy from `packages/workspace/.env.example`. Used when running workspace
server logic and AI tools outside the full Studio shell.

| Variable                 | Required | Description                                                                 |
| ------------------------ | -------- | --------------------------------------------------------------------------- |
| `APP_AI_GATEWAY_API_KEY` | no       | API key for the bundled AI gateway route when enabled.                      |
| `APP_ANTHROPIC_API_KEY`  | no       | Anthropic provider key for direct model calls.                              |
| `APP_CEREBRAS_API_KEY`   | no       | Cerebras provider key.                                                      |
| `APP_GOOGLE_API_KEY`     | no       | Google (Gemini) provider key.                                               |
| `APP_GROQ_API_KEY`       | no       | Groq provider key.                                                          |
| `APP_OPENAI_API_KEY`     | no       | OpenAI provider key.                                                        |
| `APP_OPENROUTER_API_KEY` | no       | OpenRouter provider key.                                                    |
| `APP_ZAI_API_KEY`        | no       | Z.ai provider key.                                                          |
| `APP_REGISTRY_DIR_PATH`  | no       | Path to the skills registry directory. Default: repo `registry/` submodule. |

At least one provider key is needed for model calls that do not go through the
platform gateway. Studio normally reaches models via the platform API
(`MAIN_VITE_APP_API_BASE_URL`), not these keys.
