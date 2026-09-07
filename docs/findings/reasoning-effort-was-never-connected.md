# Reasoning effort was never connected

**Status:** fixed 2026-09-06 across `llm-request.ts`, `reasoning-effort.ts` and `parse-workers-ai-models.ts`. The durable part is why it looked like a tuning problem for weeks: three independent gates were closed, each sufficient on its own to make every setting a no-op, and none of them logged anything. Companion reading: [which Workers AI models can run the product](which-workers-ai-models-can-run-the-product.md), every number in which would have been different a day earlier.

Changing a task's reasoning level did nothing, and could not have. Asked to think less, the free model kept taking a median 22.8 seconds before saying a word.

## The three gates

1. **The agent turn never asked for a level.** `llm-request.ts` called `providerOptionsForModel(aiSDKModel)` with the options argument omitted entirely, so `effort` was `undefined` and the branch that builds the parameter never ran. The only caller in the repo that ever passed one was title generation, hard-coded to `low`.
2. **The translation table had no entry for the provider.** `reasoningProviderOptions` keys on the family in the AI SDK provider id and knew five: `anthropic`, `google`, `openai`, `openrouter`, `xai`. Workers AI arrives as `openai-compatible` — the family key is the config's own type — so it resolved to `undefined` before any request body was built. The SDK does support the field; the gap was entirely on our side, and the namespace it reads is `openaiCompatible` rather than one named for the family.
3. **No Workers AI model claimed to reason.** Cloudflare publishes `"reasoning"` in `supported_features`, and `parse-workers-ai-models.ts` read that array only for `"tools"`. With no reasoning capability on the model record, the second gate in `reasoningProviderOptions` dropped the level again for any provider that is not OpenRouter.

Any one of these produces the same symptom. Fixing one or two produces the same symptom. That is what makes this worth writing down.

## What it was worth

GLM 5.3 Flash, ~114 first turns per level, seconds to the first token a user can read — not time to first chunk, which is under a second everywhere because the first chunk is reasoning:

| Level | Median | p90 | Reasoning chars before the answer |
| --- | --- | --- | --- |
| none | 22.8 | 61.7 | 2,824 |
| low | 1.6 | 4.8 | 102 |
| medium | 17.0 | 77.4 | 2,010 |
| high | 4.9 | 8.3 | 765 |

`medium` behaves like sending nothing at all. `low` is fourteen times faster and takes the model's right-first-move rate from 83% to 56%, so it is the wrong default despite being the dramatic number. `high` is the setting, and the Workers AI catalog entry now declares it as the default, consumed by `llm-request.ts` when a task carries no level of its own.

## Two rules the fix has to keep

- **Only ever the model's own stated default, and only when it already reasons.** Naming the level a model was going to use anyway makes it explicit; sending one to a model whose reasoning is off by default turns it on and charges for it. Both facts come from the catalog, and `default_enabled` genuinely varies — of the OpenRouter models reporting a reasoning block, 147 give no default effort at all and several have reasoning off.
- **A rung the model refuses is a 400 that ends the turn.** Cloudflare says whether a model reasons and never at what levels. Measured across the sixteen tool-calling Workers AI models: `low` and `medium` accepted by all sixteen, `high` by fifteen, `minimal` by seven. The capability we publish is the measured set, with the one refuser carrying a named exception. An API that serves these models to clients has the same obligation and should clamp a requested level down to the nearest supported rung rather than pass it through, because a model swapped behind an alias can have a different vocabulary.

## Where a level lives

On the task, beside the model, because a task runs on one model for its whole life and the level is part of that choice. A task the conversation starts inherits the conversation's unless `task new --effort` names one; `task models` prints the levels each model takes and its default, so the conversation can choose and can run one brief at two levels to compare them. It is read per turn rather than captured with the session's context, so changing it takes effect on the next turn rather than the next session.
