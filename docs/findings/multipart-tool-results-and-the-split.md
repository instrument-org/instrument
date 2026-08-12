# Splitting media out of tool results

A tool result can carry text and media together. Some providers accept that; others take only a string there. For the ones that do not, [split-multipart-tool-results.ts](../../packages/workspace/src/lib/split-multipart-tool-results.ts) rewrites the tool result down to its text and re-attaches the media as a following user message.

That rewrite is not free, and for OpenRouter it is no longer needed. This records why it exists, what it costs, how OpenRouter was cleared, and what would have to be true to clear another provider.

## What the rewrite does to a conversation

The wire bodies, same conversation both ways, captured against the real provider:

```jsonc
// split
{ "role": "tool",  "tool_call_id": "call-1", "content": "Image file: shot.png (1456x819)." }
{ "role": "user",  "content": [ { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } } ] }
{ "role": "user",  "content": "what does it show?" }

// unsplit
{ "role": "tool",  "tool_call_id": "call-1",
  "content": [ { "type": "text", "text": "Image file: shot.png (1456x819)." },
               { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } } ] }
{ "role": "user",  "content": "what does it show?" }
```

The split invents a user turn the user never took. The model reads a tool result announcing an image it does not contain, then an unattributed image apparently sent by the user, then the real user message. It also breaks user/assistant alternation and adds a message boundary the prompt cache has to work around, and because the transcript is replayed whole, every later turn carries it again.

Whether that measurably degrades answers is unmeasured. The structural cost is not in doubt.

## Why it was written, and why that reason expired

The pass landed 2025-12-08 against a version of `@openrouter/ai-sdk-provider` that dropped structured content in tool results. Upstream fixed it on 2026-03-16, in "preserve structured multimodal content in tool results" (upstream issue #181, PR #446). `mapToolResultContentParts` there maps a content output into `image_url` / `video_url` / `input_audio` / `file` parts. The fix is present in the version this repo pins.

Two layers have to agree for that to work, and they do:

- `read_file` emits the deprecated `media` shape. The provider's mapper does not handle `media`; unhandled shapes fall through to `JSON.stringify(part)`, which would put megabytes of base64 into the transcript as text.
- It never reaches the provider as `media`. The AI SDK's own `convertToLanguageModelMessage` rewrites `media` to `image-data` or `file-data` on every request, downstream of everything in [prepare-model-messages.ts](../../packages/workspace/src/lib/prepare-model-messages.ts).

So the shape arrives as something the provider maps correctly. Worth knowing if either half is ever changed: emitting `image-data` directly from `read_file` would be equally correct, and pinning an older provider would silently reintroduce the base64-as-text failure.

## What was verified before flipping OpenRouter

48 live calls, 20 models, through the real provider path.

- Every model that answered at all answered both ways. No model rejected media inside a tool result.
- Two models failed identically split and unsplit, for unrelated reasons: one deprecated at the provider, one with no image-capable endpoint.
- Parallel tool calls answered in a single tool message, only one result carrying media, were accepted by every model tried. That is the shape the agent produces when it reads a file and lists a directory in one step, and the one most likely to break `tool_call_id` pairing.

Coverage spanned OpenAI, Anthropic, Google, xAI, Qwen, Moonshot, MiniMax, Z-AI, Mistral, Meta, StepFun, and Gemma model families.

## Why only OpenRouter was flipped

The quirk is per provider type, and a model family says nothing about the provider type that reaches it. Testing `x-ai/grok-4.5` **through OpenRouter** exercises OpenRouter's endpoint and the OpenRouter provider package. The `x-ai` provider type goes direct through `@ai-sdk/xai`, a different converter against a different API, and remains untested.

`supportsMultipartToolResults` is therefore true for `anthropic`, `google`, `openai`, `openrouter`, and the app's own provider type, which is served by OpenRouter and inherits its capabilities. Every other type still splits.

Clearing another one means the same two checks: read that provider package's tool-result converter to confirm it preserves content parts, then send the shape to real models on that provider and confirm the API accepts it, parallel tool calls included.

## What the other likely providers do

The first check has been run on the types most likely to be used. It settles four of them on its own, because a converter that discards content parts cannot be rescued by anything downstream.

| Provider type | Package                                  | Tool result carrying media becomes          |
| ------------- | ---------------------------------------- | ------------------------------------------- |
| `cerebras`    | `@ai-sdk/openai-compatible`, via wrapper | `JSON.stringify` of the whole content array |
| `together`    | `@ai-sdk/openai-compatible`, via wrapper | same                                        |
| `z-ai`        | `@ai-sdk/openai-compatible`, by fallback | same                                        |
| `x-ai`        | `@ai-sdk/xai`, chat path                 | same                                        |
| `vercel`      | `@ai-sdk/gateway`                        | converted server-side, not locally          |

`JSON.stringify` is worse than the split, not merely different: it puts the base64 payload into the transcript as prose, so the image's bytes are spent as text tokens, the model learns nothing from them, and the result is saved and replayed on every later turn.

`@ai-sdk/openai-compatible` is also the fallback for any provider type with no explicit mapping, so its behavior covers more than the three rows above.

`vercel` is the one the code cannot answer: `@ai-sdk/gateway` forwards the prompt and lets the service convert per upstream. A live check got a correct answer unsplit from one model on one upstream, which is a hint and not a clearance; the free tier rate-limited the rest of the run. It needs a paid key and a spread of upstreams before it moves.

Providers not examined here still split, which is the safe default. `openai-compatible` points at whatever a user configures and cannot be cleared at all.

### Whether a newer package would change any of that

Mostly no, and the exception is not reachable by upgrading alone. `@ai-sdk/provider` 3.x is the AI SDK v6 line this repo is on; 4.x is v7.

- **`@ai-sdk/openai-compatible` is not a version problem.** The `JSON.stringify` branch is identical in the version pinned here, in the highest v6-compatible release, and in the current v7 release. The package exposes only a chat surface, with no responses path to carry structured output, so `cerebras`, `together`, `z-ai`, and every user-configured endpoint stay incapable no matter what is installed.
- **`@ai-sdk/xai` is a version problem with a catch.** Its responses path gained real handling within the v6 line, mapping `image-data` and `image-url` to `input_image`. Its chat path still stringifies, in every release including the current v7 one. Models are created with a bare `sdk(modelId)` call in [fetch-ai-sdk-model.ts](../../packages/ai-gateway/src/lib/fetch-ai-sdk-model.ts), which resolves to chat on the v6 line, so bumping the package changes nothing on its own. On the v7 line that bare call defaults to responses instead, so the AI SDK v7 upgrade would land xAI on the working path as a side effect. Re-test it then rather than reaching for `sdk.responses` early, which swaps the whole API surface for one fix.
- **`@ai-sdk/gateway` is unaffected either way**, since it forwards the prompt and converts nothing locally.
- **The OpenRouter provider is already at its v6 ceiling**, so there is no headroom left to take there.

## The capability filter has to come first

This change depends on a fix that landed just before it, and the order is load-bearing.

`filterUnsupportedMedia` replaces media a model cannot read with a note. Until recently its tool-result branch matched only `image-data` and `file-data`, which nothing produced, so it was dead code. For a splitting provider that did not matter: the split moved the image into a user message first, where the working branch caught it.

Remove the split while that branch is dead and an image reaches a model with no image input. That is not a silent degradation, it is a failed request — the live runs produced exactly that error from a model with no image-capable endpoint, and a failed request on a saved transcript repeats on every later turn.

So: the tool-result branch of the capability filter must work before a provider stops splitting. It does now, through the shared traversal in [model-message-parts.ts](../../packages/workspace/src/lib/model-message-parts.ts).

## If this regresses

Symptoms would be a provider error naming image or content parts in a tool message, or a model that stops acknowledging images it just read.

Reverting is one line per provider: drop `quirks` from that entry in [metadata.ts](../../packages/ai-gateway/src/lib/providers/metadata.ts) and it splits again. The pass is still exercised by every other provider type, so it will not have rotted.
