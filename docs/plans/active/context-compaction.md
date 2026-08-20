# Context compaction

Status: **proposed**. Owner: TBD. Nothing exists yet; this is a from-scratch feature. Tracked as FP-222. This is the canonical plan for the feature; the earlier "intelligent context compression" framing, which proposed per-payload compressors for tool output, is a different and separable problem, covered by [tool result context budgets](../completed/tool-result-context-budgets.md).

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

## Prior art: four harnesses, two designs

This plan originally proposed adapting opencode's `packages/opencode/src/session/compaction.ts` ([github.com/sst/opencode](https://github.com/sst/opencode)). Reading codex ([github.com/openai/codex](https://github.com/openai/codex)), pi-mono, and grok-build against it changed the recommendation. The designs differ on the question that matters, which is what survives a compaction, and opencode's answer is the weaker one.

Three of the four independently converged on retaining user messages verbatim: codex walks them back under a token budget, grok-build assembles a `<user_query>`-wrapped preamble with middle-cut truncation of overlong ones, and pi-mono extracts file operations mechanically rather than trusting prose. That convergence is the strongest available evidence for the shape recommended below.

### What we are not taking from opencode

**Recency-based tool-output pruning.** `compaction.ts` walks backwards, protects the most recent `PRUNE_PROTECT = 40_000` tokens of tool output, and erases everything older in place. This is cheap and needs no model call, which is why an earlier draft of this plan proposed it as phase 1. It is also wrong in a way that is hard to notice. [A public critique of opencode](https://wren.wtf/shower-thoughts/stop-using-opencode/) works the failure through: a spec read into context at the start of a session is exactly the thing you still need forty turns later, and it is the first thing a recency window evicts. The agent then continues confidently against a document it can no longer see. opencode's own mitigation, a hardcoded `PRUNE_PROTECTED_TOOLS = ["skill"]`, is an admission that recency is the wrong axis. codex does not prune tool output at all. Neither should we.

**Selection as a tail of turns.** opencode keeps the last `tail_turns` turns subject to a token budget, with a `splitTurn()` fallback when one turn exceeds it. This is where the tool-call pairing risk lives, since a `tool-result` severed from its `tool-call` is rejected by every provider. The codex shape below removes the risk by construction rather than defending against it.

**Giving up when compaction overflows.** opencode stops with "Session too large to compact". codex loops instead: see below.

**Firing on the agent-to-user transition, which includes interruption.** The critique's sharpest concrete finding is that pruning runs when the user interrupts, so "if you need to pull the clanker out of a rabbit hole and re-steer it, OpenCode immediately trashes the prompt cache". Interruption is the worst possible moment to rewrite history: the user is about to supply the correction that makes the recent context matter, and they pay a full prefill for the privilege. Our trigger set must exclude it explicitly rather than by omission.

### The cost the critique is right about, and cannot be designed away

Compaction is, in the critique's words, "a leaky abstraction that tries to make a finite context window look like an infinite one." Rewriting the head of the transcript invalidates the cached prefix by construction, so every compaction is followed by a full prefill of the new prefix. That is inherent, not an implementation flaw, and the honest response is to make compaction rarer and less load-bearing rather than to pretend the cost is not there. Two things follow, and both are in the phasing below: warn the agent early enough that it can write its own handoff notes, and offer a rollover mode that starts a clean window instead of paying for a summary.

The related point about cache invalidation is worth recording even though it is out of scope here: [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) rebuilds the `session-context` message once it is more than `STALE_MESSAGE_THRESHOLD_MINUTES` old, which moves the cached prefix on a timer for reasons unrelated to whether anything changed. Worth measuring separately.

### The codex shape, which this plan now recommends

**The compacted history is not a tail.** `build_compacted_history` in `codex-rs/core/src/compact.rs` produces exactly three things: the initial context, then every user message verbatim walking backwards under a 20k token budget (truncating the one that straddles the boundary), then the summary appended as a final user message behind a `SUMMARY_PREFIX`. Every assistant message, every tool call, and every tool result is discarded.

This single decision is why the design is better than opencode's. The constraint a user set fifty turns ago is not summarized and hoped for; it is retained as the literal text they typed. That is a direct answer to the "silent capability loss" risk, which is the one risk in this feature that nobody notices when it fires. It also dissolves the pairing problem: a history with no tool calls in it cannot orphan a tool result.

**Overflow during compaction is a loop, not a failure.** When the compaction request itself exceeds the window, codex calls `history.remove_first_item()` and retries, with the comment "Trim from the beginning to preserve cache (prefix-based) and keep recent messages intact." It only reports an error once a single item is left.

**Two limits, not one.** `session/context_window.rs` distinguishes a soft `auto_compact_token_limit` that triggers compaction from the model's hard context window, tracks `base_window_tokens_remaining` against both, and reserves a buffer only when there is a fallback prompt to spend it on. It also supports counting either the full active context or only the tokens added after the initial prefix.

**No estimator in the trigger path.** Every codex trigger decision reads reported usage from `get_total_token_usage()`. An estimator exists but sits behind a trace-level log for telemetry comparison, not control flow. This contradicts the earlier draft of this plan, which proposed building an estimator first. Reported usage plus reactive handling is sufficient; pi-mono's hybrid in `packages/ai/src/utils/estimate.ts`, which anchors on the last real usage number and estimates only the messages after it, is the better approach if we later want a live gauge in the UI, and it correctly invalidates an assistant message's usage when a summary was inserted after it.

**The agent is warned before anything is rewritten.** `session/token_budget.rs::maybe_record` injects a developer-role message once remaining tokens fall below a threshold: "Your context window is nearly exhausted (only {n_remaining} tokens remaining) and will be automatically reset for you soon. Once reset, message items in current context window will be cleared in the new window, but notes and history items will be persistent across windows." At zero remaining it injects a configurable fallback prompt, which in codex's own tests reads "Write notes before rollover." This is the critique's recommended explicit-handoff workflow, implemented inside the harness instead of left to the user to remember.

**Compaction without a model call.** `compact_token_budget.rs` is a second implementation that skips summarization entirely and installs a fresh context window, deliberately modeled through the same lifecycle so hooks and UI observe it identically. Combined with the warning above, this is a complete strategy on its own: tell the agent to write notes, then start clean.

**More triggers than the obvious one.** Besides pre-turn and post-sampling checks, `session/turn.rs` compacts when switching to a model with a smaller context window (using the _previous_ model to do the compacting) and when the model's prompt-compatibility hash changes. The first of those answers an open question in [session recovery](session-recovery-from-unsendable-content.md).

**They do not pretend it is lossless.** Every compaction emits a user-facing warning: "Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted." And every compaction emits a telemetry event carrying tokens before and after, retained image count, summary tokens, cache read and write tokens, trigger, reason, and duration.

### What pi-mono still contributes

Its summarization prompt is a rigid template (Goal / Constraints and Preferences / Progress split into Done, In Progress, Blocked / Key Decisions / Next Steps / Critical Context) with a **separate** update prompt for the compact-a-compaction case that spells out preserve-versus-replace rules. codex's prompt is four bullets and much vaguer. pi-mono also extracts file operations mechanically into `<read-files>` and `<modified-files>` sections rather than trusting the model to remember paths, and it serializes the head to flat text with a system prompt saying not to continue the conversation. Take the template, the update prompt, and the mechanical file list.

### What grok-build contributes: the part that decides whether a compaction is allowed to land

grok-build factors compaction into a standalone engine, `crates/common/xai-grok-compaction`, with the trigger wiring left to each host. Its full-replace style is the same shape codex arrived at, so it is corroboration rather than a third option. What it has that neither of the others does is an explicit answer to "what if the compaction itself is bad", and that is the layer this plan was missing.

**A compaction can be rejected, and failing to compact is not fatal.** `intra_compaction/trigger.rs` states the posture outright: "All errors are non-fatal, the caller should log and continue without compaction. Worst case the next sampling call may fail with 400, which is the same as today." Compaction is an attempt to improve a session, never a precondition for continuing it. This is the opposite of opencode's terminal "Session too large to compact", and it is the single most important thing to copy, because it means a broken compaction path degrades to today's behavior instead of to a dead session.

**Three named rejection reasons, each cheap to implement.**

- *Degenerate summary.* `is_degenerate_summary` rejects a cleaned summary shorter than `MIN_SUMMARY_SEED_CHARS = 500` and retries it as a transient failure. The constant carries its own justification: the smallest healthy summary observed in production was around 3,242 characters, so 500 is far below anything real. This catches the model returning "Okay, I understand." as a summary, which is the failure that silently destroys a session.
- *Insufficient reduction.* `InsufficientReduction` rejects a result that is not smaller than the input by `max_reduction_ratio` (0.8 by default). A compaction that does not shrink the history has spent a model call and a cached prefix for nothing.
- *Not worth doing.* `select_turns_to_compact` returns nothing when the compactable region is below `min_compactable_tokens` (5,000 by default).

**Structural validation before persisting.** `history/validate.rs` rejects empty text with a reason that generalizes to any store-backed design: an empty summary "would be silently skipped on hydration while blocking future compaction triggers". A compaction that persists nothing but marks the session compacted is worse than no compaction, because it also suppresses the next attempt.

**Tool-pair safety by construction, with a stated snap direction.** `select.rs` walks backward to a candidate split, then snaps *forward* past the trailing tool results so the compacted region is self-contained and cannot orphan a tool result. Under the codex shape recommended here we discard tool calls wholesale and the problem does not arise, but the snap-forward rule is what to reach for if a later phase ever retains tool output.

**Retry classification specific to compaction.** `code_compaction/failure.rs` splits failures into `Deterministic` and `Transient` and refuses to sleep-and-retry the former, treating a context-length overflow as deterministic "regardless of status (backends sometimes dress it as a synthesized 500)". Our [classify-provider-error.ts](../../../packages/workspace/src/lib/classify-provider-error.ts) already does this job better, matching structured provider codes rather than prose, so this is a validation of the existing seam rather than something to port. `FullReplaceConfig` defaults are three attempts, three seconds apart, 120 second timeout.

**The threshold is a percent of the window, with a per-model override.** `DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT = 85`, overridable per model and then by user config and env. This answers the open question below about whether our user-message budget should be a constant or a fraction.

**Live agent state is re-injected mechanically after compaction, not summarized.** `reminder.rs` formats a post-compaction `<system-reminder>` carrying running background tasks, the TODO list, and running subagents, with the host adding its own sections for files, agent instructions, skills, and connectors. `assemble.rs` appends it as the final item of the compacted history. This is a stronger idea than the prose summary it accompanies: anything the harness can enumerate should be re-stated as fact rather than left to the model to have remembered. It is also what makes a no-summarization rollover viable, since the same block can be emitted with no model call at all.

**Two-pass compaction moves the latency off the critical path.** Behind a remote flag and off by default, `two_pass_compaction_enabled` summarizes the history prefix in the background as the session approaches the threshold, then summarizes that note plus the recent tail when compaction actually fires. This is the only direct answer any of the four harnesses has to the critique's "sit for 10 minutes while the LLM prefills the entire session" complaint. Note where it lands: it is a recent, flagged-off optimization at a company with a dedicated compaction crate, which is a fair signal about when we should consider it.

## Recommended design

Compaction produces a new history of the form:

```
[session-context] + [user messages, verbatim, newest-first under a token budget] + [summary as a user message behind a handoff prefix]
```

Original messages are retained on disk and hidden from assembly, so the boundary is a view rather than a destructive edit. Media in discarded assistant and tool history goes away with it; media in retained user messages is preserved.

Where the harness can enumerate a fact, the compacted history states it rather than relying on the summary to have mentioned it: the working folder, the attached folders, the files read and written, and any open task state. The summary covers intent and discovered knowledge, which are the only things that genuinely require a model call.

### Invariants

These hold for every phase, and each one is a test rather than a review note.

1. **Compaction never ends a session.** Every failure path leaves the pre-compaction history intact and lets the turn proceed. A session that cannot be compacted behaves exactly as it does today.
2. **A compaction that does not shrink the history is discarded.** Compare assembled token counts before and after and keep the original when the result is not meaningfully smaller.
3. **A degenerate summary is discarded.** Enforce a floor on summary length before it is allowed to replace anything.
4. **A rejected compaction does not suppress the next attempt.** Nothing is persisted that marks the session compacted unless a compaction actually landed.
5. **Every user message either survives verbatim or is deliberately truncated in the middle.** No user message is ever summarized away.
6. **Assembly output is structurally valid.** No tool result without its tool call, no empty content.

## Phasing

Phases 0 through 2 are the recommended first release and are described together below as the small slice. Phases 3 onward add the summarization model call and should be justified by what real sessions do at the phase 2 boundary.

### The small slice: phases 0 through 2

Phases 0 through 2 make no summarization request, rewrite no history, and invalidate no cached prefix. Every objection in the critique is an objection to summarizing compaction specifically: the prefill cost of rewriting the head, the leaky abstraction of an apparently infinite window, and the interaction between compaction and pruning. None of them apply to a slice that only measures the window, warns the agent, and offers a clean one. The critique's own recommended workaround, "an explicit handoff by telling the clanker to write out notes", is what phases 1 and 2 automate. It is the rare case where the smallest correct version is also the one the critic asked for.

What this slice does not do is keep a session alive without the user noticing. Rollover is a visible boundary and the agent has to carry its own state across it. That is the honest tradeoff, and it should be measured before phase 3 is built: if agents reliably write useful notes when warned, phase 3 buys less than it appears to.

0. **A context window to measure against.** Carry an optional `contextLength` through `AIGatewayModel.Schema` and the fetch-models mappers, per "Where the context window comes from" below. Optional is the whole design: a model whose window we do not know disables the feature rather than guessing. Nothing else in this plan can be built first, and on its own it enables a context gauge in the UI.
1. **Budget and warning.** Compare current context occupancy against the window minus a named reserve, with a soft limit distinct from the hard one. Inject a budget warning at a threshold and a write-your-notes prompt at zero. No history is rewritten in this phase, and it is independently valuable.

   **Occupancy is the last assistant message's own usage, not a session total.** [usage-summary-compute.ts](../../../packages/workspace/src/lib/usage-summary-compute.ts) sums `metadata.usage` across every assistant message and folds in `generate_image` and `web_search` tool usage on top. That is the right number for cost reporting and the wrong one here, by a wide margin: every turn resends the prefix, so summing input tokens across turns counts the prefix once per turn, and image and search tokens never occupied this model's window at all. Read the most recent assistant message's `metadata.usage` instead and add its input, cache-read, and cache-write components. Both codex and opencode take the last turn's reported usage for exactly this reason.
2. **Rollover.** Start a fresh window carrying session context, the retained user messages, durable notes, and a mechanically assembled state block in grok-build's `reminder.rs` shape: working folder, attached folders, files read and written, and any open task state. No summarization request. Reachable manually and automatically. Cheapest correct way to keep a session alive, and the state block is what makes it more than a session reset.
3. **Summarizing compaction.** The history shape above, the pi-mono prompt template plus its update variant, mechanical file lists, the summary message and boundary marker, and remove-oldest-and-retry when the summarization request itself overflows. The invariants above become the acceptance path: reject a degenerate or non-shrinking summary, fall back to phase 2 rollover when a summary is rejected, and persist nothing on rejection.
4. **Triggers.** Pre-turn, post-turn, on a classified context-overflow error, and on a switch to a model with a smaller window. Never on user interruption, for the reason above; a cancelled turn leaves the history alone. The overflow classification already exists: `classifyProviderError` in [classify-provider-error.ts](../../../packages/workspace/src/lib/classify-provider-error.ts) returns a `context-overflow` verdict, and this phase should consume it rather than growing its own check.
5. **Visibility.** Transcript treatment of the boundary, the honest warning about multi-compaction sessions, telemetry with before and after token counts, and a setting to disable the automatic path.

## Where the context window comes from

The window is optional on the model, and an absent window disables budgeting, warning, and automatic rollover for that model. Nothing else degrades: the session behaves exactly as it does today, and the reactive path in phase 4 still catches an overflow the provider reports. opencode reaches the same conclusion in `session/overflow.ts`, where `limit.context === 0` makes `isOverflow` return false unconditionally.

That single decision is what keeps this from becoming a model-metadata project. Sourcing then falls into three tiers, cheapest first.

**Live provider data, which covers more than it appears to.** Two of our mappers are already handed the number and discard it:

- [google.ts](../../../packages/ai-gateway/src/lib/fetch-models/google.ts) parses `inputTokenLimit` into its Zod schema and never reads it.
- OpenRouter returns `context_length`, which [parse-openrouter-models.ts](../../../packages/ai-gateway/src/lib/fetch-models/parse-openrouter-models.ts) does not declare, so it is dropped at parse.

Vercel's gateway carries the same field through the AI SDK. Our own first-party gateway is OpenRouter-shaped, so it comes along for free. This tier costs one schema field and two mapper lines, and it needs no new network call, no bundled data, and no release to pick up a new model.

**A small shipped table for the providers whose APIs omit it.** The real gap is narrower than "BYOK": Anthropic's `/v1/models` returns id, display name, created date, and type; OpenAI's returns id, created, object, and owned by. Neither carries a limit, and generic OpenAI-compatible endpoints usually carry nothing. Sized against models.dev, the missing data is 42 OpenAI models and 13 Anthropic ones, under 1.4 KB as a flat map. This is the same shape as [get-model-features.ts](../../../packages/ai-gateway/src/lib/get-model-features.ts), which already ships prefix heuristics per model family and already falls back to a conservative default for anything it does not recognize. Extending an established pattern by a couple of dozen numbers is not the same commitment as adopting a metadata pipeline.

**A refreshable snapshot, if breadth later justifies it.** [models.dev](https://models.dev) publishes 6,288 models across 184 providers, 98% of them carrying a context limit, as a 3.65 MB `api.json`; filtered to provider, model, and context length it is roughly 200 KB. opencode bundles a snapshot at build time and refreshes it at runtime from its own mirror rather than from models.dev directly. Worth adopting only when tier two demonstrably fails users, and worth noting that it trades the release cadence problem for a third-party availability and provenance problem rather than removing it. Verify the data license before shipping any of it.

Two properties make the tiers sufficient without a fourth. Live data wins over the table when both exist, so a new model from OpenRouter, Google, Vercel, or our own gateway is correct on the day it ships with no release. And an overflow error observed in phase 4 is itself evidence of the true ceiling for that model, so a wrong or missing entry is recoverable from the session that hit it rather than permanent.

## Testing without spending a window's worth of tokens

Reaching a real context limit to exercise this costs a large session per run, which means it would be tested once and then never again. The way out is to make the window an input rather than a constant, at which point every threshold is reachable in a three-turn conversation.

- **The decision is a pure function.** `(occupancy, window, reserve) -> ok | warn | write-notes | rollover` has no I/O and is the whole of phase 1's logic. Table-driven `it.each` cases with `toMatchInlineSnapshot` cover the boundaries, the absent-window case, and the reserve arithmetic for nothing.
- **A development override that shrinks the window.** Setting an effective window of a few thousand tokens for a session drives the real path, with real reported usage, real warning injection, real rollover, and real UI, for the price of a short conversation. This is the affordance that makes the feature testable more than once, so it should be built in phase 0 alongside the field rather than retrofitted.
- **Replay an existing task instead of generating one.** A recorded task already carries per-message usage metadata. Pointing a shrunk window at a real transcript puts a session over any threshold on its next turn with no token generation at all, and makes the case reproducible across runs.
- **Absent-window regression.** Assert that a model with no known window produces no warning, no rollover, and a byte-identical assembled prompt. This is the BYOK default and the "nothing changes for sessions that never approach the limit" criterion, and it is the one behavior a bug here would make everyone's problem.
- **What only a real agent can answer.** Whether a model, warned that its window is nearly full, writes notes good enough to carry the task across a rollover. That is the evidence phase 3 should be built on, and per [validate-changes](../../../.agents/skills/validate-changes/SKILL.md) it wants `pnpm eval run` across several models rather than a unit test.

## Decisions to make before building

- **Notes need somewhere durable to live.** Phases 1 and 2 both assume the agent can write something that survives a window reset. If that is a file in the task directory, the write-your-notes prompt should name the path. This is the load-bearing dependency of the cheap phases and it is currently unspecified.
- **Where the summary lives in our schema.** We have a `session-context` role already. A summary is a different thing with a similar shape, and codex encodes its summary as a plain user message with a text prefix rather than a new role, which is worth considering for how little it costs.
- **Summarize with which model.** The session's model is the obvious default. A cheaper one is tempting and risks a worse summary at exactly the moment the summary is load-bearing.
- **The user-message budget.** codex uses 20k tokens. Ours should be a fraction of the window rather than a constant, since the range of models we run is wider. grok-build supports this: its trigger threshold is a percent of the window with a per-model override, and a per-model override is the escape hatch to plan for.
- **What a rejected compaction falls back to.** Phase 3 needs an answer and phase 2 supplies it: rollover. Worth confirming that the fallback is rollover rather than proceeding uncompacted, since a session at the hard limit cannot proceed uncompacted.

Settled by the grok-build reading, recorded so they are not reopened:

- **Compaction failure is non-fatal.** Always degrade, never terminate the session.
- **The threshold is a percent of the context window**, not a token constant, defaulting near 85% with a per-model override.
- **Rollover alone is enough to ship.** Phases 0 through 2 are a complete, honest feature with no summarization request and no history rewriting, and the critique's recommended manual workaround is exactly what they automate. Phase 3 should be justified by evidence from real sessions at the phase 2 boundary rather than by assumption.

## Risks

- **Silent capability loss.** Retaining user messages verbatim removes the worst version of this, but the agent's own discovered state, meaning what it learned from tool output, still survives only in prose. The summarization prompt remains the highest-leverage and least testable part of this feature.
- **Prompt caching.** Rewriting the prefix invalidates the cache for that turn by construction, and [add-cache-control.ts](../../../packages/workspace/src/lib/add-cache-control.ts) places breakpoints over the assembled messages. Expected and acceptable; it should be measured rather than discovered.
- **Compaction quality degrading over successive compactions.** codex warns users about this in the product. We should be prepared to as well.
- **The mechanical state block drifting from what the harness actually knows.** Re-stating enumerable facts is only better than prose if the enumeration stays current. A state block that names a stale working folder is more damaging than one that omits it, because the agent will trust it.
- **Session recovery no longer gets a free degrade path.** The earlier draft claimed compaction's `stripMedia` would serve as [session recovery](session-recovery-from-unsendable-content.md) phase 2's escalation. Under the codex shape, compaction discards tool and assistant media wholesale and keeps user media, so it does not provide a media-stripping mode. That plan keeps its own degrade path.
