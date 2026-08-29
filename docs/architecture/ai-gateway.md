# ai-gateway

`packages/ai-gateway` is how the rest of the app reaches AI models. It wears two hats:

1. **A mounted HTTP app** that reverse-proxies model API calls, injecting provider credentials and attribution server-side so keys never reach the renderer.
2. **A library** of model discovery, identity, and image/web-search helpers imported by `workspace` and `studio`.

It sits below `workspace` in the layering (see [system-overview.md](system-overview.md)) and depends only on `shared`.

## The HTTP app

[`app.ts`](../../packages/ai-gateway/src/app.ts) builds a Hono app based at `AI_GATEWAY_API_PATH`. It is not booted on its own; the workspace server mounts it ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)), supplying `getAIProviderConfigs`, `captureException`, and `clientInfo` (non-identifying desktop-client metadata) through Hono context.

- **Auth** — every request passes `createAuthMiddleware()`.
- **Provider proxy** — [`routes/provider.ts`](../../packages/ai-gateway/src/routes/provider.ts) handles `/providers/:providerConfigId/*` (mounted at `PROVIDERS_PATH`). It looks up the provider config by id, rewrites the path onto the provider's real base URL (`apiURL`), sets auth (`setProviderAuthHeaders`) and attribution (`setAttributionHeaders`) headers, and streams the proxied response back. The `x-client-session-id` header is stripped from every request and re-set — together with `clientInfo` — only for the first-party provider, so a third-party provider reached with a user key never sees client identity.
- **Closed by default** — any unmatched route returns 404 and reports an exception, so the gateway is never an open proxy.

Provider configs (which carry the API keys) originate in Studio's main-process stores (`getAIProviderConfigs`) and flow in via `WorkspaceConfig`; the renderer never sees them. When the user is signed in, a synthesized first-party config joins them, carrying their auth token and pointing at the platform gateway (`OUR_PROVIDER_CONFIG`).

## The library

The package has four entry points (`package.json` `exports`): the root [`index.ts`](../../packages/ai-gateway/src/index.ts), `./client` (a handful of schema types for the renderer), `./model-cache`, and `./schemas` — the Zod schemas without the provider stack, because importing the root pulls in every AI SDK provider at around a second of module evaluation that a test runner pays per file. Grouped by job:

- **Model discovery** — `fetch-model`, `fetch-model-results`, `fetch-ai-sdk-model`, backed by the per-provider fetchers in `lib/fetch-models/` (one file per provider; adding a provider means adding a file there). Results are cached via `model-cache` (Studio persists this to disk as `diskModelCache`).
- **Provider config & selection** — `select-provider-configs`, `env-for-provider-configs`, `providers/metadata`, `verify-api-key`, `fetch-credits`.
- **Model identity & metadata** — `schemas/model-uri` and `image-capabilities`, which give one canonical identity for a model across providers. (Naming and feature detection — `canonicalize-model-id`, `generate-model-name`, `is-model-new`, `get-model-features` — are internals of the fetch stack, not exports.)
- **Image & web search** — `get-ai-sdk-image-model`, `stream-image`, `get-ai-sdk-web-search-model`.
- **AI SDK glue** — `ai-sdk-provider-options`.

## Schemas

[`schemas/`](../../packages/ai-gateway/src/schemas/) defines the model and provider data model: `model`, `model-uri`, `provider-config`, `provider-metadata`. These are the shared shapes for model metadata and provider records; treat them as the source of truth and reuse them rather than re-describing model shape elsewhere. (This area evolves as provider/model support changes; read the schemas for current fields.)

## Consumers

- **workspace** — mounts the app into its server, uses `env-for-provider-configs` when spawning runtimes, and calls model/image helpers from agents and tools.
- **studio** — persists the model cache (`stores/model-cache`), supplies provider configs, and drives model-picker / model-badge UI from the model library and schemas.
