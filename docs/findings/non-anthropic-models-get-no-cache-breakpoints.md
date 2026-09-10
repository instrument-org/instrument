# Non-Anthropic models get no cache breakpoints

**Status:** resolved 2026-09-10, no code change: the gate is right and stays. Recorded 2026-09-10 from a GLM task transcript. Both open questions below are settled. The `openai-compatible` provider in that run was Workers AI, and a direct probe (below) shows it accepts a `cache_control` marker and ignores it: the same clustered, replica-dependent hit pattern with the marker as without, so there is no breakpoint to send. And `cacheWriteTokens` is `unknown` because the OpenAI-compatible wire format has no write field (`prompt_tokens_details.cached_tokens` is the whole of it; see `openaiCompatibleTokenUsageSchema` in `@ai-sdk/openai-compatible`), so our mapping is faithful and a caching change on this path is measured through reads. `addCacheControlToMessages` now says why its gate is `isAnthropic`.

`addCacheControlToMessages` is gated on `isAnthropic(model)`. For every other model the function returns the messages untouched, so no cache marker of any kind reaches the provider.

## The gate

```ts
export function addCacheControlToMessages({ messages, model }) {
  if (isAnthropic(model)) {
    // ... the only branch that sets providerOptions
  }
  return messages;
}
```

The `providerOptions` object inside that branch carries four dialects:

```ts
{ anthropic: {...}, bedrock: {...}, openaiCompatible: {...}, openrouter: {...} }
```

which reads as multi-provider support and is not. All four are reachable only when `isAnthropic` is already true, so they cover an Anthropic model *served through* OpenRouter or an OpenAI-compatible endpoint. A GLM, a Qwen, or a Llama on the same endpoint takes the early return. `isAnthropic` matches on author, provider, or the strings `anthropic`/`claude` in the canonical id, so there is no path by which a non-Anthropic model reaches the branch.

## What it costs

From a 14-step task run against `zai-org/glm-5.3-flash` on the `openai-compatible` provider:

| | tokens |
| --- | --- |
| input | 262,026 |
| cache read | 95,488 |
| cache write | 0 |

Cache reads land on roughly half the steps and are zero on the rest, against a session prefix that only grows and is otherwise byte-stable (`session-context` is written once and reused; see `packages/workspace/CLAUDE.md`). The pattern is what implicit provider-side caching looks like when nothing is asking for it: sometimes the provider matches a prefix, often it does not.

`cacheWriteTokens` is reported as `unknown` on every single step, so we cannot see writes on this path even when they happen.

## What the probe measured

The run's `openai-compatible` provider was Workers AI (`api.cloudflare.com/.../ai/v1`, the endpoint `cf:` models resolve to), not Z.ai's own API. A direct call to it with `@cf/zai-org/glm-5.3-flash`, a fixed 9.6K-token system prompt, and a fresh one-line user turn per call, repeated with and without `cache_control: { type: "ephemeral" }` on both messages (the field the `openaiCompatible` dialect spreads onto the message), over three runs on 2026-09-10:

| condition | follow-up calls | reported `cached_tokens` = 9600 | latency, hit vs miss |
| --- | --- | --- | --- |
| no marker | 17 | 5 | 668-862 ms vs 711-1747 ms |
| marker on system and user | 10 | 3 | 674-905 ms vs 723-1960 ms |

The marker is accepted (no 400) and changes nothing: hits arrive in runs of two or three consecutive calls and then stop, with or without it, which is what block-level prefix caching keyed on which replica serves the request looks like. The `9600` is the whole prefix in 64-token blocks. So the half-and-half pattern in the transcript is the ceiling this provider offers, and nothing in the request moves it.

`cacheWriteTokens` is not ours to fix: the OpenAI-compatible usage object carries `prompt_tokens_details.cached_tokens` and nothing about writes, so the SDK has nothing to map. Reads are reported, which is enough to measure any future change on this path.

## Why it matters beyond cost, revisited

The probe's calls took 0.7 to 1.0 s end to end on a 9.6K prefix whether or not the prefix was cached, with one 9 s outlier that was not a miss. A cold prefix is therefore not what made the transcript's first chunk take 8 to 11 s; that is provider-side queueing or variance, and a caching change would not have touched it.

## Why it looked like a latency finding

Time to first chunk in that run was repeatedly 8-11 seconds on a model whose name is "flash", with `completionTokensPerSecond` as low as 3.2 on short outputs. A cold prefix of roughly 20K tokens on every other request was the first explanation reached for; the probe above rules it out.
