# Context compaction

Status: **proposed**. Owner: TBD. Nothing exists yet; this is a from-scratch feature.

## Problem

A task has no way to outlive the model's context window. [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) assembles the entire transcript on every turn, so a long session grows monotonically until the provider refuses it. At that point every later turn fails identically, which is the same permanent-failure shape described in [session recovery](session-recovery-from-unsendable-content.md): the history is on disk, it is replayed in full, and nothing prunes it.

There is no summarization, no tail selection, and no token-budget check before sending. Worse, there is nothing to check against: `AIGatewayModel.Schema` in [model.ts](../../../packages/ai-gateway/src/schemas/model.ts) carries no context length, and [map-openrouter-shaped-model.ts](../../../packages/ai-gateway/src/lib/fetch-models/map-openrouter-shaped-model.ts) drops the upstream `context_length` field on the floor. What does exist is [usage-summary-compute.ts](../../../packages/workspace/src/lib/usage-summary-compute.ts), which totals input and output tokens from persisted message metadata, so we know how large a session has become but not how large it is allowed to get.

## Goal

A task can run indefinitely, and the agent is told it is running out of room while it still has room to act.

### Success criteria

- A session that would exceed the context window continues instead of failing.
- The agent keeps working on the same task across a compaction boundary, without re-asking for information the user already gave.
- Before any automatic history rewrite, the agent has been warned and given a turn to record durable notes.
- Compaction is visible in the transcript. The user can see that it happened and what survived.
- A session already over the limit when compaction ships recovers on its next turn rather than staying broken.
- Nothing changes for sessions that never approach the limit.

## Prior art: three harnesses, two designs

This plan originally proposed adapting opencode's `packages/opencode/src/session/compaction.ts` ([github.com/sst/opencode](https://github.com/sst/opencode)). Reading codex ([github.com/openai/codex](https://github.com/openai/codex)) and pi-mono against it changed the recommendation. The two designs differ on the question that matters, which is what survives a compaction, and opencode's answer is the weaker one.

### What we are not taking from opencode

**Recency-based tool-output pruning.** `compaction.ts` walks backwards, protects the most recent `PRUNE_PROTECT = 40_000` tokens of tool output, and erases everything older in place. This is cheap and needs no model call, which is why an earlier draft of this plan proposed it as phase 1. It is also wrong in a way that is hard to notice. [A public critique of opencode](https://wren.wtf/shower-thoughts/stop-using-opencode/) works the failure through: a spec read into context at the start of a session is exactly the thing you still need forty turns later, and it is the first thing a recency window evicts. The agent then continues confidently against a document it can no longer see. opencode's own mitigation, a hardcoded `PRUNE_PROTECTED_TOOLS = ["skill"]`, is an admission that recency is the wrong axis. codex does not prune tool output at all. Neither should we.

**Selection as a tail of turns.** opencode keeps the last `tail_turns` turns subject to a token budget, with a `splitTurn()` fallback when one turn exceeds it. This is where the tool-call pairing risk lives, since a `tool-result` severed from its `tool-call` is rejected by every provider. The codex shape below removes the risk by construction rather than defending against it.

**Giving up when compaction overflows.** opencode stops with "Session too large to compact". codex loops instead: see below.

### The cost the critique is right about, and cannot be designed away

Compaction is, in the critique's words, "a leaky abstraction that tries to make a finite context window look like an infinite one." Rewriting the head of the transcript invalidates the cached prefix by construction, so every compaction is followed by a full prefill of the new prefix. That is inherent, not an implementation flaw, and the honest response is to make compaction rarer and less load-bearing rather than to pretend the cost is not there. Two things follow, and both are in the phasing below: warn the agent early enough that it can write its own handoff notes, and offer a rollover mode that starts a clean window instead of paying for a summary.

The related point about cache invalidation is worth recording even though it is out of scope here: [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) rebuilds the `session-context` message once it is more than `STALE_MESSAGE_THRESHOLD_MINUTES` old, which moves the cached prefix on a timer for reasons unrelated to whether anything changed. Worth measuring separately.

### The codex shape, which this plan now recommends

**The compacted history is not a tail.** `build_compacted_history` in `codex-rs/core/src/compact.rs` produces exactly three things: the initial context, then every user message verbatim walking backwards under a 20k token budget (truncating the one that straddles the boundary), then the summary appended as a final user message behind a `SUMMARY_PREFIX`. Every assistant message, every tool call, and every tool result is discarded.

This single decision is why the design is better than opencode's. The constraint a user set fifty turns ago is not summarized and hoped for; it is retained as the literal text they typed. That is a direct answer to the "silent capability loss" risk, which is the one risk in this feature that nobody notices when it fires. It also dissolves the pairing problem: a history with no tool calls in it cannot orphan a tool result.

**Overflow during compaction is a loop, not a failure.** When the compaction request itself exceeds the window, codex calls `history.remove_first_item()` and retries, with the comment "Trim from the beginning to preserve cache (prefix-based) and keep recent messages intact." It only reports an error once a single item is left.

**Two limits, not one.** `context_window.rs` distinguishes a soft `auto_compact_token_limit` that triggers compaction from the model's hard context window, tracks `base_window_tokens_remaining` against both, and reserves a buffer only when there is a fallback prompt to spend it on. It also supports counting either the full active context or only the tokens added after the initial prefix.

**No estimator in the trigger path.** Every codex trigger decision reads reported usage from `get_total_token_usage()`. An estimator exists but sits behind a trace-level log for telemetry comparison, not control flow. This contradicts the earlier draft of this plan, which proposed building an estimator first. Reported usage plus reactive handling is sufficient; pi-mono's hybrid in `packages/ai/src/utils/estimate.ts`, which anchors on the last real usage number and estimates only the messages after it, is the better approach if we later want a live gauge in the UI, and it correctly invalidates an assistant message's usage when a summary was inserted after it.

**The agent is warned before anything is rewritten.** `session/token_budget.rs::maybe_record` injects a developer-role message once remaining tokens fall below a threshold: "Your context window is nearly exhausted (only {n_remaining} tokens remaining) and will be automatically reset for you soon. Once reset, message items in current context window will be cleared in the new window, but notes and history items will be persistent across windows." At zero remaining it injects a configurable fallback prompt, which in codex's own tests reads "Write notes before rollover." This is the critique's recommended explicit-handoff workflow, implemented inside the harness instead of left to the user to remember.

**Compaction without a model call.** `compact_token_budget.rs` is a second implementation that skips summarization entirely and installs a fresh context window, deliberately modeled through the same lifecycle so hooks and UI observe it identically. Combined with the warning above, this is a complete strategy on its own: tell the agent to write notes, then start clean.

**More triggers than the obvious one.** Besides pre-turn and post-sampling checks, `session/turn.rs` compacts when switching to a model with a smaller context window (using the _previous_ model to do the compacting) and when the model's prompt-compatibility hash changes. The first of those answers an open question in [session recovery](session-recovery-from-unsendable-content.md).

**They do not pretend it is lossless.** Every compaction emits a user-facing warning: "Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted." And every compaction emits a telemetry event carrying tokens before and after, retained image count, summary tokens, cache read and write tokens, trigger, reason, and duration.

### What pi-mono still contributes

Its summarization prompt is a rigid template (Goal / Constraints and Preferences / Progress split into Done, In Progress, Blocked / Key Decisions / Next Steps / Critical Context) with a **separate** update prompt for the compact-a-compaction case that spells out preserve-versus-replace rules. codex's prompt is four bullets and much vaguer. pi-mono also extracts file operations mechanically into `<read-files>` and `<modified-files>` sections rather than trusting the model to remember paths, and it serializes the head to flat text with a system prompt saying not to continue the conversation. Take the template, the update prompt, and the mechanical file list.

## Recommended design

Compaction produces a new history of the form:

```
[session-context] + [user messages, verbatim, newest-first under a token budget] + [summary as a user message behind a handoff prefix]
```

Original messages are retained on disk and hidden from assembly, so the boundary is a view rather than a destructive edit. Media in discarded assistant and tool history goes away with it; media in retained user messages is preserved.

## Phasing

0. **A context window to measure against.** Carry `contextLength` through `AIGatewayModel.Schema` and the fetch-models mappers. Nothing else in this plan can be built first, and on its own it enables a context gauge in the UI.
1. **Budget and warning.** Compare reported usage from [usage-summary-compute.ts](../../../packages/workspace/src/lib/usage-summary-compute.ts) against the window minus a named reserve, with a soft limit distinct from the hard one. Inject a budget warning at a threshold and a write-your-notes prompt at zero. No history is rewritten in this phase, and it is independently valuable.
2. **Rollover.** Start a fresh window carrying session context and durable notes, with no summarization request. Reachable manually and automatically. Cheapest correct way to keep a session alive.
3. **Summarizing compaction.** The history shape above, the pi-mono prompt template plus its update variant, mechanical file lists, the summary message and boundary marker, and remove-oldest-and-retry when the summarization request itself overflows.
4. **Triggers.** Pre-turn, post-turn, on a classified context-overflow error, and on a switch to a model with a smaller window. The overflow classification already exists: `classifyProviderError` in [classify-provider-error.ts](../../../packages/workspace/src/lib/classify-provider-error.ts) returns a `context-overflow` verdict, and this phase should consume it rather than growing its own check.
5. **Visibility.** Transcript treatment of the boundary, the honest warning about multi-compaction sessions, telemetry with before and after token counts, and a setting to disable the automatic path.

## Decisions to make before building

- **Notes need somewhere durable to live.** Phases 1 and 2 both assume the agent can write something that survives a window reset. If that is a file in the task directory, the write-your-notes prompt should name the path. This is the load-bearing dependency of the cheap phases and it is currently unspecified.
- **Where the summary lives in our schema.** We have a `session-context` role already. A summary is a different thing with a similar shape, and codex encodes its summary as a plain user message with a text prefix rather than a new role, which is worth considering for how little it costs.
- **Summarize with which model.** The session's model is the obvious default. A cheaper one is tempting and risks a worse summary at exactly the moment the summary is load-bearing.
- **The user-message budget.** codex uses 20k tokens. Ours should be a fraction of the window rather than a constant, since the range of models we run is wider.
- **Whether rollover alone is enough to ship.** Phases 0 through 2 are a complete, honest feature with no summarization request and no history rewriting. Phase 3 might be better justified by evidence from real sessions than by assumption.

## Risks

- **Silent capability loss.** Retaining user messages verbatim removes the worst version of this, but the agent's own discovered state, meaning what it learned from tool output, still survives only in prose. The summarization prompt remains the highest-leverage and least testable part of this feature.
- **Prompt caching.** Rewriting the prefix invalidates the cache for that turn by construction, and [add-cache-control.ts](../../../packages/workspace/src/lib/add-cache-control.ts) places breakpoints over the assembled messages. Expected and acceptable; it should be measured rather than discovered.
- **Compaction quality degrading over successive compactions.** codex warns users about this in the product. We should be prepared to as well.
- **Session recovery no longer gets a free degrade path.** The earlier draft claimed compaction's `stripMedia` would serve as [session recovery](session-recovery-from-unsendable-content.md) phase 2's escalation. Under the codex shape, compaction discards tool and assistant media wholesale and keeps user media, so it does not provide a media-stripping mode. That plan keeps its own degrade path.
