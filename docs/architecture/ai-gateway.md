# ai-gateway

`packages/ai-gateway` is how the rest of the app reaches AI models. It wears two hats:

1. **A mounted HTTP app** that reverse-proxies model API calls, injecting provider credentials and attribution server-side so keys never reach the renderer.
2. **A library** of model discovery, identity, and image/web-search helpers imported by `workspace` and `studio`.

It sits below `workspace` in the layering (see [system-overview.md](system-overview.md)) and depends only on `shared`.

## The HTTP app

[`app.ts`](../../packages/ai-gateway/src/app.ts) builds a Hono app based at `AI_GATEWAY_API_PATH`. It is not booted on its own; the workspace server mounts it ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)), supplying `getAIProviderConfigs` and `captureException` through Hono context.

- **Auth** — every request passes `createAuthMiddleware()`.
- **Provider proxy** — [`routes/provider.ts`](../../packages/ai-gateway/src/routes/provider.ts) handles `/:providerConfigId/*`. It looks up the provider config by id, rewrites the path onto the provider's real base URL (`apiURL`), sets auth (`setProviderAuthHeaders`) and attribution (`setAttributionHeaders`) headers, and streams the proxied response back.
- **Closed by default** — any unmatched route returns 404 and reports an exception, so the gateway is never an open proxy.

Provider configs (which carry the API keys) originate in Studio's main-process stores (`getAIProviderConfigs`) and flow in via `WorkspaceConfig`; the renderer never sees them.

## The library

[`index.ts`](../../packages/ai-gateway/src/index.ts) is the public surface. Grouped by job:

- **Model discovery** — `fetch-models`, `fetch-model`, `fetch-model-results`, `fetch-ai-sdk-model`; results cached via `model-cache` (Studio persists this to disk as `diskModelCache`).
- **Provider config & selection** — `select-provider-configs`, `env-for-provider-configs`, `providers/metadata`, `verify-api-key`, `fetch-credits`.
- **Model identity & metadata** — `canonicalize-model-id`, `schemas/model-uri`, `generate-model-name`, `is-model-new`, `get-model-features`, `image-capabilities`. These give one canonical identity for a model across providers.
- **Image & web search** — `get-ai-sdk-image-model`, `stream-image`, `get-ai-sdk-web-search-model`.
- **AI SDK glue** — `ai-sdk-provider-options`, `ai-sdk-for-provider-config`.

## Schemas

[`schemas/`](../../packages/ai-gateway/src/schemas/) defines the model and provider data model: `model`, `model-uri`, `provider-config`, `provider-metadata`. These are the shared shapes for model metadata and provider records; treat them as the source of truth and reuse them rather than re-describing model shape elsewhere. (This area evolves as provider/model support changes; read the schemas for current fields.)

## Consumers

- **workspace** — mounts the app into its server, uses `env-for-provider-configs` when spawning runtimes, and calls model/image helpers from agents and tools.
- **studio** — persists the model cache (`stores/model-cache`), supplies provider configs, and drives model-picker / model-badge UI from the model library and schemas.
