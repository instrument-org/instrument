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

## The capability filter has to come first

This change depends on a fix that landed just before it, and the order is load-bearing.

`filterUnsupportedMedia` replaces media a model cannot read with a note. Until recently its tool-result branch matched only `image-data` and `file-data`, which nothing produced, so it was dead code. For a splitting provider that did not matter: the split moved the image into a user message first, where the working branch caught it.

Remove the split while that branch is dead and an image reaches a model with no image input. That is not a silent degradation, it is a failed request — the live runs produced exactly that error from a model with no image-capable endpoint, and a failed request on a saved transcript repeats on every later turn.

So: the tool-result branch of the capability filter must work before a provider stops splitting. It does now, through the shared traversal in [model-message-parts.ts](../../packages/workspace/src/lib/model-message-parts.ts).

## If this regresses

Symptoms would be a provider error naming image or content parts in a tool message, or a model that stops acknowledging images it just read.

Reverting is one line per provider: drop `quirks` from that entry in [metadata.ts](../../packages/ai-gateway/src/lib/providers/metadata.ts) and it splits again. The pass is still exercised by every other provider type, so it will not have rotted.
