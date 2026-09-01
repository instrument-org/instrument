# What the provider's default reasoning effort buys, and what it costs

**Status:** measured 2026-09-01 against 790 real agent turns. The agent default stays where it is; title generation is the one call the numbers condemn. Nothing about the request path has changed, so these figures describe the app as it ships.

We have never sent a reasoning parameter. Not from the client, where [fetch-ai-sdk-model.ts](../../packages/ai-gateway/src/lib/fetch-ai-sdk-model.ts) builds the model as `sdk(model.providerId)` with no settings object and the OpenRouter provider emits `reasoning` and `include_reasoning` only from settings; not from [ai-sdk-provider-options.ts](../../packages/ai-gateway/src/lib/ai-sdk-provider-options.ts), whose only additions are OpenAI-Responses encrypted-reasoning flags on a branch the auto model never takes; and not from the gateway, which swaps the model id and adds `trace`, `usage.include`, and `user` to a body it otherwise forwards untouched. Every turn therefore runs at whatever the provider decided, and for the model behind auto the catalog answers that precisely: reasoning is not mandatory, is enabled by default, supports `max, xhigh, high, medium, low, none`, and defaults to **medium**.

The question this record exists to answer is whether medium is the right place to leave it. The transcripts settle the economics and cannot settle the quality.

## What medium actually spends

790 assistant turns served by the auto model's target between 2026-08-18 and 2026-09-01, read out of the per-task record files:

| | reasoning tokens |
| --- | --- |
| median | 22 |
| p90 | 191 |
| p99 | 545 |
| turns at exactly zero | 29% |

Medium on this model is not a fixed budget. Split the same turns by their position inside a user request and the spend lands almost entirely on the turn that answers a human:

| turn | n | reasoning = 0 | median | p90 | median time to first chunk |
| --- | --- | --- | --- | --- | --- |
| 1, straight after the user | 65 | 1.5% | 66 | 315 | 3.7s |
| 2 | 61 | 84% | 0 | 30 | 2.4s |
| 3 | 59 | 15% | 34 | 175 | 3.4s |
| 6 and later | 496 | 27% | 21 | 193 | 3.3s |

The model thinks when someone has just spoken to it and mostly declines on the mechanical tool-loop turns that follow. That shape is the strongest argument against reaching for a global increase: a higher level buys most of its extra thinking on exactly the turns where the model has already judged thinking unnecessary.

`finishReason` was `tool-calls` on 726 of the 790 and `stop` on the other 64. It was `length` on none of them, so the 32,000-token output ceiling in [llm-token-limits.ts](../../packages/workspace/src/lib/llm-token-limits.ts) is nowhere near binding and reasoning is not crowding out answers in agent turns.

## Money is not the constraint

Priced at the model's published rates over those same 790 turns, with input running 96% cache reads:

- $1.91 in total, **$0.0024 per turn**
- reasoning tokens account for **3.3% of the spend**
- multiply reasoning by eight and the bill rises 23%, to $0.0030 a turn

There is no budget argument for staying at medium. Whatever a higher level is worth, it is not being blocked by cost.

## Latency is

Regressing time to first chunk on reasoning tokens across all 790 turns gives **TTFB ≈ 3.1s + 7ms per reasoning token**. The intercept is prompt processing against a mostly cached 60k-token context; the slope is what thinking adds.

Per user request, across the 65 complete requests in that window:

| | median | p90 |
| --- | --- | --- |
| assistant turns | 10 | 29 |
| wall clock | 57.5s | 282s |
| model time | 47.1s | 164s |
| summed time to first chunk | 30.6s | 113s |
| reasoning tokens | 564 | 2,116 |

Model time is 88% of a request's wall clock, and more than half of the request is spent waiting for a first chunk that has not arrived. If a step up the ladder roughly quadruples reasoning, the median request gains about twelve seconds, a fifth of its length, for ten percent more money. That is the real trade, and it is a trade against the thing the user watches rather than against the bill.

## What these numbers cannot say

Whether those twelve seconds would change an outcome. There is no counterfactual in a transcript: every turn recorded here ran at one level, and nothing in the record says what a different level would have produced. Only an eval answers that.

The one quality proxy available is too dirty to lean on. Bash commands exited non-zero on 10.6% of the auto model's calls against 3.2% for a Claude model over the same install, but sampling the 269 failures shows they are mostly environment discovery, a missing Python module, a read-only mount, a stale browser element reference, rather than failures of thinking, and the models were driving different tasks. Explicit tool errors were 0.6% of tool calls.

**Do not compare reasoning token counts across providers.** They measure different things. Claude Sonnet turns in the same install carried a reasoning part on 56% of turns while reporting zero reasoning tokens, so a table of "who thinks least" built on the token field is a table of who reports it. Within one provider the field is sound, which is why everything above is scoped to a single model.

The token counts may also undercount within that model. Reasoning appears to arrive at roughly 143 tokens per second by the regression, against the 30 to 80 tokens per second these same turns generate text at, which is the signature of a reported number standing in for more work than it names.

## What follows

**The agent default stays at the provider default.** It is the level the vendor tuned the model's own adaptivity against, the spend profile shows the model already allocating sensibly across a request, and there is no measured failure to fix. Moving it would be a guess that costs a fifth of every request.

**Title generation should not run at the agent's level.** [generate-title-from-user-message.ts](../../packages/workspace/src/lib/generate-title-from-user-message.ts) runs the task's own model to produce at most eight words, inside a budget that reasoning shares, and the code already carries a guard for the case where thinking spends the budget before a title is written. It is the only call site these numbers condemn outright. The same argument covers the search summarizer reached through [get-ai-sdk-web-search-model.ts](../../packages/ai-gateway/src/lib/get-ai-sdk-web-search-model.ts).

Landing that across providers rather than only for OpenRouter-shaped ones is phases 1 through 3 of [model-request-controls.md](../plans/active/model-request-controls.md), because asking a model for a level it does not support is a request error on a direct key, and knowing which models support what is the metadata that plan reads.

**The experiment that would settle the agent default** is the same phase 3, which is testable with no UI at all: make the level settable on the request path, then run the cases in [evals/cases](../../packages/workspace/evals/cases) at low, medium, high, and xhigh and read pass rate against wall clock. The harness already reports cost per run and would need wall clock and reasoning tokens beside it.

One adjacent lever worth knowing about: the `-pro` variant of the same model, which is that model with its reasoning mode raised, carries an identical per-token price. It is unreachable today for the same reason effort is, and it is demoted out of the picker by [demote-variants-of-listed-models.ts](../../packages/ai-gateway/src/lib/demote-variants-of-listed-models.ts) on purpose.

## How to run this again

Every number here comes from the per-task record files under the app's workspace directory, one SQLite file per task, without touching the network. Assistant messages carry `metadata.modelIdServed`, `metadata.usage.outputTokenDetails.reasoningTokens`, `metadata.msToFirstChunk`, `metadata.msToFinish`, and `metadata.finishReason`; tool parts carry `state` and, for shell calls, `output.exitCode`. Group messages into requests by walking a session in message-id order and starting a new request at each user message. Prices come from the model catalog rather than from anything stored locally. The [task-database-query](../../.agents/skills/task-database-query/SKILL.md) skill is the safe read-only way in.

The window above is one developer's install over fifteen days, weighted toward work on this repository, and 65 requests is a small sample for anything at the tail. Treat the shape as real and the second decimal place as not.
