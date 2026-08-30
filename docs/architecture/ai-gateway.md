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
- **Which model answered** — `is-router-model` says whether a request named a decision rather than a model, and `find-cached-model` resolves a provider's own id to a record without a network fetch. Together they let a caller tell a router picking a model apart from a provider substituting one. See [Requested and served models](#requested-and-served-models).
- **Image & web search** — `get-ai-sdk-image-model`, `stream-image`, `get-ai-sdk-web-search-model`.
- **AI SDK glue** — `ai-sdk-provider-options`.

## Requested and served models

A provider does not always answer with the model the request named. Two different things cause that, and they need telling apart: a request for a **router** (`instrument/auto`, `openrouter/auto`) names a decision rather than a model, so a different answer is the feature working; a request naming a model outright and getting another back is a **substitution**.

The AI SDK carries the answer on `finish-step` as `response.modelId`, which every provider we bundle populates from its own response body except `@ai-sdk/google` — it never emits `response-metadata`, so a Gemini request reports nothing at all no matter which version is pinned. The SDK seeds that field with the id we sent and overwrites it only when a provider reports one, so **an id equal to the request is not evidence that anything confirmed it**. Only a difference can have come from the provider, which is why `SessionMessage` records the served id only when it differs and treats absence as "no evidence" rather than "same model".

Compare on the provider's own id (`AIGatewayModel.providerId`), never on `canonicalId`. The canonical id has the author stripped and any date normalized, so `claude-haiku-4.5` against `anthropic/claude-haiku-4.5` differs on every message; comparing that way reports a substitution on every turn and a real one never stands out. Resolving the served id back to a record (`find-cached-model`) is also what keeps a dated snapshot from reading as a substitution, since `claude-sonnet-4-5-20250929` and `claude-sonnet-4.5` are one model.

## Schemas

[`schemas/`](../../packages/ai-gateway/src/schemas/) defines the model and provider data model: `model`, `model-uri`, `provider-config`, `provider-metadata`. These are the shared shapes for model metadata and provider records; treat them as the source of truth and reuse them rather than re-describing model shape elsewhere. (This area evolves as provider/model support changes; read the schemas for current fields.)

## Consumers

- **workspace** — mounts the app into its server, uses `env-for-provider-configs` when spawning runtimes, and calls model/image helpers from agents and tools.
- **studio** — persists the model cache (`stores/model-cache`), supplies provider configs, and drives model-picker / model-badge UI from the model library and schemas.
