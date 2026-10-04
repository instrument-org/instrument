# ai-gateway

`packages/ai-gateway` is how the rest of the app reaches AI models. It wears two hats:

1. **A mounted HTTP app** that reverse-proxies model API calls, injecting provider credentials and attribution server-side so keys never reach the renderer.
2. **A library** of model discovery, identity, and image/web-search helpers imported by `workspace` and `studio`.

It sits below `workspace` in the layering (see [system-overview.md](system-overview.md)) and depends only on `shared`.

## The HTTP app

[`app.ts`](../../packages/ai-gateway/src/app.ts) builds a Hono app based at `AI_GATEWAY_API_PATH`. It is not booted on its own; the workspace server mounts it ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)), supplying `getAIProviderConfigs`, `captureException`, and `clientInfo` (non-identifying desktop-client metadata) through Hono context.

- **Auth** — every request passes `createAuthMiddleware()`.
- **Provider proxy** — [`routes/provider.ts`](../../packages/ai-gateway/src/routes/provider.ts) handles `/providers/:providerConfigId/*` (mounted at `PROVIDERS_PATH`). It looks up the provider config by id, rewrites the path onto the provider's real base URL (`apiURL`), sets auth (`setProviderAuthHeaders`) and attribution (`setAttributionHeaders`) headers, and streams the proxied response back. A `chatgpt` config's `POST /responses` is rewritten on the way out to the narrower request a ChatGPT plan accepts ([`chatgpt-plan-request.ts`](../../packages/ai-gateway/src/lib/providers/chatgpt-plan-request.ts)). The `x-client-session-id` header is stripped from every request and re-set — together with `clientInfo` — only for the first-party provider, so a third-party provider reached with a user key never sees client identity.
- **Closed by default** — any unmatched route returns 404 and reports an exception, so the gateway is never an open proxy.

Provider configs (which carry the API keys) originate in Studio's main-process stores (`getAIProviderConfigs`) and flow in via `WorkspaceConfig`; the renderer never sees them. When the user is signed in, a synthesized first-party config joins them, carrying their auth token and pointing at the platform gateway (`OUR_PROVIDER_CONFIG`), and each ChatGPT account signed in brings a `chatgpt` config for its plan, with an id of its own.

## The library

The package has four entry points (`package.json` `exports`): the root [`index.ts`](../../packages/ai-gateway/src/index.ts), `./client` (a handful of schema types for the renderer), `./model-cache`, and `./schemas` — the Zod schemas without the provider stack, because importing the root pulls in every AI SDK provider at around a second of module evaluation that a test runner pays per file. Grouped by job:

- **Model discovery** — `fetch-model`, `fetch-model-results`, `fetch-ai-sdk-model`, backed by the per-provider fetchers in `lib/fetch-models/` (one file per provider; adding a provider means adding a file there). Results are cached via `model-cache` (Studio persists this to disk as `diskModelCache`).
- **Provider config & selection** — `select-provider-configs`, `providers/metadata`, `verify-api-key`, `providers/fetch-credits`, `reasoning-effort`.
- **Decision model**: `decision-model`, a classifier that answers typed questions about a state with calibrated probabilities rather than text, used where the app needs a choice rather than prose.
- **Model identity & metadata** — `schemas/model-uri` and `image-capabilities`, which give one canonical identity for a model across providers. (Naming and feature detection — `canonicalize-model-id`, `generate-model-name`, `is-model-new`, `get-model-features` — are internals of the fetch stack, not exports.)
- **Which model answered** — `names-same-model` decides whether a provider's answer names the model that was asked for, `is-router-model` says whether the request named a decision rather than a model, and `find-cached-model` resolves a provider's own id to a record without a network fetch. Together they let a caller tell a router picking a model apart from a provider substituting one. See [Requested and served models](#requested-and-served-models).
- **Image & web search** — `get-ai-sdk-image-model`, `stream-image`, `get-ai-sdk-web-search-model`.
- **AI SDK glue** — `ai-sdk-for-provider-config` picks the SDK package for a config's type, `openrouter-language-model` picks the request shape for a model behind an OpenRouter-shaped config, and `ai-sdk-provider-options` builds the per-request options from the catalog. See [Two request shapes behind OpenRouter](#two-request-shapes-behind-openrouter).

## Two request shapes behind OpenRouter

OpenRouter answers on two APIs: Chat Completions, one string per reply, and the Responses API, a list of typed items. The `openrouter` and first-party configs use both, chosen per model by [`openrouter-language-model.ts`](../../packages/ai-gateway/src/lib/openrouter-language-model.ts): OpenAI's models and our own aliases (`instrument/auto`, which the platform gateway resolves to an OpenAI model) go to `/responses` through `@ai-sdk/openai`'s Responses model, and every other vendor goes to `/chat/completions` through `@openrouter/ai-sdk-provider`, which carries that vendor's reasoning fixes. Both reach the same gateway URL, so the proxy, auth, and attribution do not change.

The reason is `phase`. GPT-5 models write a reply as message items tagged `commentary` and `final_answer`, and OpenAI says a history that drops the tag degrades them. Chat Completions cannot represent two message items, so OpenRouter's bridge concatenates their text with a blank line, the phase is gone, and a turn whose commentary and final answer are the same words arrives as one line said twice. On the Responses path each item is its own text part with `providerMetadata.openai.phase`, which the store keeps and hands back as `providerOptions` on the next turn. [A reply that arrives twice](../findings/a-reply-that-arrives-twice.md) has the measurements.

Three things the Responses path has to carry that Chat Completions did not: `store: false` on every request, since OpenRouter keeps nothing and the SDK would otherwise replay an earlier reply as a reference to its item id; `forceReasoning` for a model the catalog says reasons, since the SDK reads reasoning support off a bare `gpt-5` id and ours carry a vendor prefix; and `reasoningSummary: "auto"`, so the transcript keeps showing the model's thinking the way the Chat Completions path did, even on a turn that sets an effort. The first is a middleware on the model itself (`defaultSettingsMiddleware`), so no caller can leave it off; the other two come from `providerOptionsForModel`, which knows the catalog. With storage off on a model it treats as reasoning, the SDK asks for `reasoning.encrypted_content` on its own, so the model's reasoning comes back encrypted and replays on the next turn. Encrypted reasoning is bound to the model that produced it, so `remove-cross-model-reasoning-details` in workspace strips it, as it strips OpenRouter's, when a session's model changes.

## Requested and served models

A provider does not always answer with the model the request named. Two different things cause that, and they need telling apart: a request for a **router** (`instrument/auto`, `openrouter/auto`) names a decision rather than a model, so a different answer is the feature working; a request naming a model outright and getting another back is a **substitution**.

The AI SDK carries the answer on `finish-step` as `response.modelId`, which every provider we bundle populates from its own response body except `@ai-sdk/google` — it never emits `response-metadata`, so a Gemini request reports nothing at all no matter which version is pinned. The SDK seeds that field with the id we sent and overwrites it only when a provider reports one, so **an id equal to the request is not evidence that anything confirmed it**. Only a difference can have come from the provider, which is why `SessionMessage` records the served id only when it differs and treats absence as "no evidence" rather than "same model".

Compare with `namesSameModel` on the provider's own id (`AIGatewayModel.providerId`), never on `canonicalId`. Two things make a plain `!==` wrong. The canonical id has the author stripped, so `claude-haiku-4.5` against `anthropic/claude-haiku-4.5` differs on every message and a real substitution never stands out. And a provider may answer an undated alias with the dated build behind it: OpenAI's catalog carries `gpt-5.6-luna` and its API answers `gpt-5.6-luna-2026-01-15`, which is one model pinned to a build rather than a substitution. `namesSameModel` treats a suffix beginning with a digit as that pinning, and anything else as a different model, so `gpt-5` answered by `gpt-5-mini` still reads as a substitution.

The same rule covers images and web search. Our image alias (`OUR_MODELS.image.id`) routes exactly the way the text one does, and the web-search model is chosen for the user by a priority list rather than by them, so in both cases the requested id names a decision and only the served id says what did the work.

## Schemas

[`schemas/`](../../packages/ai-gateway/src/schemas/) defines the model and provider data model: `model`, `model-uri`, `provider-config`, `provider-metadata`. These are the shared shapes for model metadata and provider records; treat them as the source of truth and reuse them rather than re-describing model shape elsewhere. (This area evolves as provider/model support changes; read the schemas for current fields.)

## Consumers

- **workspace** — mounts the app into its server, and points every in-process model and image call at it (`internalURL`), which is where a provider's credentials are added.
- **studio** — persists the model cache (`stores/machine/model-cache`), supplies provider configs, and drives model-picker / model-badge UI from the model library and schemas.
