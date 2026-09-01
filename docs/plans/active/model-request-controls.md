# Model request controls

Status: **phases 1 and 3 built**. A caller can name a level and it reaches the provider; nothing in the interface names one yet, so every agent turn still runs at whatever the provider defaults to. The one caller asking for anything is title generation, at low. Phase 2 is what a direct provider key is still waiting on, and phase 4 has not started.

## Problem

A model is more than an id. Most current models take a reasoning effort, some take a verbosity, some decide for themselves whether to think at all unless told. We expose none of it. [model-picker.tsx](../../../apps/studio/src/client/components/model-picker.tsx) resolves to an `AIGatewayModelURI` carrying a provider and a provider config id, and [llm-request.ts](../../../packages/workspace/src/logic/llm-request.ts) hands that to the SDK with whatever [ai-sdk-provider-options.ts](../../../packages/ai-gateway/src/lib/ai-sdk-provider-options.ts) adds, which today is one OpenAI-specific flag for encrypted reasoning content.

The cost is not only a missing setting. Where a provider has no request parameter for a level, vendors ship the level as a separate model id instead, and OpenRouter mirrors that: `gpt-5.6-sol-pro` is `gpt-5.6-sol` with `reasoning.mode` set to `pro`, at the same price. [demote-variants-of-listed-models.ts](../../../packages/ai-gateway/src/lib/demote-variants-of-listed-models.ts) now keeps those rows out of Recommended, because a list that carries a model twice under two names is worse than one that carries it once. That is the right call for the picker and it also means the capability is currently unreachable rather than merely unexposed. A real control is what makes those rows unnecessary instead of hidden.

The same gap costs us on the other side. An agent turn that needs care and an agent turn that needs speed are the same request today, so a task pays flagship deliberation to rename a file.

## What the catalog already tells us

This does not have to be a hardcoded table. OpenRouter's models response carries a per-model `reasoning` object that neither [parse-openrouter-models.ts](../../../packages/ai-gateway/src/lib/fetch-models/parse-openrouter-models.ts) nor [map-openrouter-shaped-model.ts](../../../packages/ai-gateway/src/lib/fetch-models/map-openrouter-shaped-model.ts) reads:

```json
{
  "mandatory": true,
  "default_enabled": true,
  "supported_efforts": ["max", "high", "low"],
  "default_effort": "max"
}
```

271 of 396 models carry that object, 130 name their `supported_efforts`, and 83 mark reasoning `mandatory`, meaning the model thinks whether or not we ask. Alongside it, `supported_parameters` lists what the model accepts (`reasoning_effort` on 133, `verbosity` on 22, `include_reasoning` on 270), and `default_parameters` carries sampling defaults where a vendor publishes them.

The reason to read this rather than write it down is that there is no single vocabulary to write down. Across the models that name their efforts there are 21 distinct sets, from `high,medium,low` through `max,xhigh,high,medium,low,none` to a model whose only supported effort is `high`. A hardcoded enum would be wrong for most models on the day it was written.

We already read one field out of this response, `supported_parameters`, and only to answer whether the model takes tools.

## What production already says

Measured over 790 real agent turns in [reasoning-effort-at-the-provider-default.md](../../findings/reasoning-effort-at-the-provider-default.md), and it moves two of the decisions below.

Reasoning is 3.3% of what a turn costs, so no level on this ladder is priced out. Time to first chunk rises about 7ms per reasoning token on a 3.1s floor, and model time is 88% of a request's wall clock, so a level is bought with the user's attention rather than with money. And the spend is already concentrated: the turn that answers a human reasons on 98.5% of occasions, the turn after it reasons on 16%. A level applied to a whole task pays most of its increase on turns the model has itself judged not to need it.

That is the case for the agent default staying at the provider's, for exempting the calls that are not agent turns, and for the control eventually living closer to the composer than to the picker.

## The split this lands in again

Only OpenRouter-shaped responses, which covers our own gateway, and Google report any of this. A direct Anthropic, OpenAI, x-ai, z-ai, Groq, Cerebras, DeepSeek, MiniMax, or Mistral key reports nothing. That is the same boundary that governs [context length](../../architecture/ai-gateway.md) and the reason a price-based recommendation rule was not taken.

Two things follow. The control has to render from metadata where there is metadata and from a small fallback table where there is not, the way the session context ring does, and it has to say which of those it is doing rather than presenting a guessed vocabulary as the model's own. And the fallback table stays small on purpose: the direct providers worth hardcoding are the four with a documented, stable effort vocabulary.

- Anthropic: `effort` of `low`, `medium`, `high`, `max`, defaulting to `high` on Sonnet 5, Opus 5, and Fable 5. Haiku 4.5 does not take it. The older `thinking.type: enabled` plus `budget_tokens` form is deprecated on the 4.6 generation and rejected on later models, so there is one shape to support, not two.
- OpenAI: `reasoning.mode`, where `pro` is the higher tier on the same model at the same price.
- Google: an effort on the 3.x line.
- xAI: an effort on Grok 4.5 and later.

## Goal

A user can say how hard a model should work on a task, and the app asks for exactly the levels that model supports.

### Success criteria

- Picking a model whose catalog entry names `supported_efforts` offers those levels and no others, with the model's own `default_effort` preselected.
- Picking a model whose provider reports nothing offers the fallback levels for that vendor, and says the levels are ours rather than the provider's.
- Picking a model that reports no reasoning support at all offers no control, rather than a disabled one.
- The chosen level reaches the provider through `providerOptionsForModel` and is visible in a recorded request.
- A model marked `mandatory` cannot be set to `none`.
- An existing task opened after this ships keeps behaving exactly as it did, at the provider default.

## Decisions to make before building

**Where the level lives.** Four candidates, and they are not equivalent.

Per-model is the least state and the most surprising: a level chosen for one task silently applies to another. Per-task matches how the model itself is already chosen and is the likely answer, storing alongside the model in the task's `settings.json`. Per-turn is what a coding agent arguably wants, since one prompt is "rename this" and the next is "find the race", but it needs a control in the composer rather than the picker, and it multiplies the recorded state on every message. Per-invocation is the one an agent that spawns other agents needs, where a parent choosing a child's model chooses its level in the same breath, and it is the direction the product is heading; it argues for a level that travels with a request rather than one read from stored state, which per-turn already is.

**What the level is for calls the user did not make.** Title generation and the search summarizer run a model the user picked for a different job. They should carry their own low level rather than inherit whatever the task is set to, and that is true whichever of the four above wins, because none of them is a control over these. Title generation is the clearer case: it produces at most eight words from a budget reasoning shares.

**Whether the level rides in the model URI.** `AIGatewayModelURI.ParamsSchema` in [model-uri.ts](../../../packages/ai-gateway/src/schemas/model-uri.ts) already carries a query string, so `?provider=...&providerConfigId=...&effort=high` is the smallest change at the call sites. It is also the largest change everywhere else: the URI is the identity of a model in the default-model preference, on every session, and in every persisted assistant message, so a model at two efforts becomes two models to every consumer that compares URIs, including the picker's own selected-state check. Carrying the level beside the URI rather than inside it keeps identity meaning identity. This decision should be made explicitly and written down, because reversing it later means migrating persisted state.

**What happens to the demoted variant rows.** Once an effort control exists, `gpt-5.6-sol-pro` is a duplicate of `gpt-5.6-sol` at `pro` rather than a model in its own right. Leaving them demoted is fine and costs nothing. Hiding them entirely is a separate call and needs the control to be reachable first.

## Phases

**Phase 1: carry the metadata.** Built. `AIGatewayModel.ReasoningSchema` in [model.ts](../../../packages/ai-gateway/src/schemas/model.ts) carries the levels a model names, its default, and whether it thinks whether or not we ask, optional in the same way and for the same reason `contextLength` is: absent means unknown, and unknown means do not guess. `map-openrouter-shaped-model.ts` fills it from the upstream `reasoning` object. Nothing renders it.

**Phase 2: the fallback table.** A vendor-keyed table of effort vocabularies for the direct providers, resolved only when the model carries no reasoning capability of its own. Same shape as the context window fallback, including saying so in the UI.

**Phase 3: the request path.** Built. [reasoning-effort.ts](../../../packages/ai-gateway/src/lib/reasoning-effort.ts) holds one ladder and a table of five providers, each with our rungs in its own words and the `providerOptions` shape its SDK reads: `reasoning.effort` for OpenRouter, `effort` for Anthropic, `reasoningEffort` for OpenAI and xAI, `thinkingConfig.thinkingLevel` for Google. Resolution only steps down, filters against the levels the model itself lists, and never asks a mandatory model for none. `providerOptionsForModel` merges the result into whatever else that model needed. A level is sent only where we have evidence the model takes one, which is a catalog capability or an OpenRouter-shaped endpoint, where an unsupported parameter is dropped upstream rather than rejected. That evidence is what phase 2 supplies for the rest.

**Phase 4: the control.** Render it in the picker, once the decision above about where the level lives is made. A segmented control over the model's own levels, absent entirely for a model with none.

**Phase 5: verbosity, and whatever else earns it.** `verbosity` is declared by 22 models and is a smaller, separable version of the same problem. Sampling parameters (`temperature`, `top_p`, `top_k`) are deliberately not in this plan: they are declared by nearly every model, they are the wrong knob for an agent that has to produce parseable tool calls, and `default_parameters` shows vendors already disagree about their defaults.

## What this is not

Not a per-request budget. Not automatic effort selection based on what the turn looks like, which is a routing problem and a different plan. Not a place to expose every parameter OpenRouter lists, which would be 25 controls, most of which make an agent worse.
