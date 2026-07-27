# Context compaction

Status: **proposed**. Owner: TBD. Nothing exists yet; this is a from-scratch feature.

## Problem

A task has no way to outlive the model's context window. [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) assembles the entire transcript on every turn, so a long session grows monotonically until the provider refuses it. At that point every later turn fails identically, which is the same permanent-failure shape described in [session recovery](session-recovery-from-unsendable-content.md): the history is on disk, it is replayed in full, and nothing prunes it.

There is no summarization, no tail selection, no token-budget check before sending. What exists is the raw material: [usage-summary-compute.ts](../../../packages/workspace/src/lib/usage-summary-compute.ts) computes input and output token counts from persisted message metadata, so we already know how large a session has become.

## Goal

A task can run indefinitely. When the transcript approaches the model's context window, older history is replaced by a summary and recent turns are kept verbatim, automatically and without losing the thread of what the user asked for.

### Success criteria

- A session that would exceed the context window continues instead of failing.
- The agent keeps working on the same task across a compaction boundary, without re-asking for information the user already gave.
- Compaction is visible in the transcript. The user can see that it happened and what was summarized.
- A session already over the limit when compaction ships recovers on its next turn rather than staying broken.
- Nothing changes for sessions that never approach the limit.

## Prior art: opencode

Recommended source to adapt, from `packages/opencode/src/session/compaction.ts` ([github.com/sst/opencode](https://github.com/sst/opencode)). Our `read_file` was already adapted from the same project, so the shapes are familiar.

Its model, in the order the pieces matter:

**Selection.** `select()` decides the boundary. It walks _turns_ rather than messages, keeps the most recent `tail_turns` (a config value) subject to a token budget computed from the model's context window, and walks backwards accumulating until the budget is spent. Everything before that point is the `head` to summarize; the boundary is recorded as `tail_start_id`. If a single turn is itself larger than the remaining budget, `splitTurn()` finds a split point inside it rather than giving up. If nothing can be kept, it returns the messages unchanged rather than producing an empty tail.

**Summarization.** The head is converted to model messages with **`stripMedia: true`** and a `toolOutputMaxChars` cap, then sent to the model with a summarization prompt. Media becomes a descriptive placeholder naming the file and type, so the summarizer is not paying image tokens to summarize. A previous summary is threaded in, so compactions compose rather than each starting from nothing.

**Storage.** The result is an assistant message with `summary: true`, `mode: "compaction"`, and a compaction part carrying `tail_start_id`. Later turns read that marker to know where real history resumes. `completedCompactions()` walks prior compactions so their inputs can be hidden from the next one.

**Triggering.** Two ways in. Proactively, when the session is near the budget. Reactively, when a request fails and the error classifies as context overflow: `processor.ts` sets `needsCompaction`, returns `"compact"` instead of stopping, and the turn continues after compacting. `config.compaction.auto === false` turns the automatic path off and surfaces the error instead.

**Continuation.** After compacting, a synthetic user message is injected telling the model to continue, and if the compaction was triggered by an overflow involving media, it also explains that attachments were dropped so the model can tell the user rather than behaving as though they were still there.

**Giving up.** If compaction itself overflows, it stops with a message that names the reason: "Session too large to compact - context exceeds model limit even after stripping media".

## What we would need to build

Mapping onto our architecture rather than copying wholesale. opencode is Effect-based and its session model differs from ours, so this is an adaptation, not a port.

- **Where it hooks.** [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) is where the transcript is assembled and where `splitMultipartToolResults`, `filterUnsupportedMedia`, `normalizeModelImages`, and `sanitizeModelText` already run. Selection belongs there or immediately before it.
- **A size estimate before sending.** Compaction must decide _before_ a request whether the payload fits. Persisted usage from a previous turn is a lagging indicator and does not cover the turn being assembled. This needs an estimator over outgoing `ModelMessage`s. pi-mono's `packages/ai/src/utils/estimate.ts` is a compact reference: characters divided by a constant, with a flat per-image charge. Cheap and approximate is the right trade here.
- **Where a summary lives.** Our session already has a `session-context` message concept (system prompt plus `agent.getMessages`, rebuilt when stale, see [packages/workspace/CLAUDE.md](../../../packages/workspace/CLAUDE.md)). A summary is a different thing with a similar shape, and the decision of whether to reuse that machinery or add a distinct message role is the main schema question this plan has to answer.
- **`stripMedia` as a conversion option**, following opencode. This is also the escalation path that [session recovery](session-recovery-from-unsendable-content.md) phase 2 wants, so building it here means that plan does not need its own degrade path.
- **The overflow trigger** is `classifyProviderError` ([classify-provider-error.ts](../../../packages/workspace/src/lib/classify-provider-error.ts)), from [session recovery](session-recovery-from-unsendable-content.md) phase 1. It already returns `context-overflow`; consume it rather than growing a second overflow check, and add a pattern there when a provider turns up that it misses.
- **UI.** A compaction boundary should be visible in the transcript rather than history silently disappearing. Scope unknown; needs a design pass.

## Suggested phasing

1. **Estimation.** A token estimator over outgoing messages, plus the model's context window from the catalogue. Ships alone, and on its own it enables a "this session is getting large" signal.
2. **Selection.** Turn detection, tail selection against a budget, and the split-a-large-turn fallback. Pure and testable with no model calls.
3. **Summarization and storage.** The prompt, the `stripMedia` conversion, the summary message and boundary marker, and threading a previous summary into the next compaction.
4. **Proactive triggering.** Compact when the assembled payload approaches the budget.
5. **Reactive triggering.** Compact on a classified context-overflow error and continue the turn, rather than failing it. Needs the classifier.
6. **UI and controls.** Transcript treatment of the boundary, plus a setting to disable automatic compaction and a way to trigger it manually.

## Decisions to make before building

- **Adapt or reimplement.** opencode's logic is worth following closely for selection and stripping. Its Effect-based session plumbing is not transferable. Recommend treating the file as a specification rather than as source.
- **Turn boundaries.** opencode compacts whole turns because splitting mid-turn can orphan a tool result from its call. Our transcript has the same constraint: a `tool-result` without its `tool-call` is rejected by providers. Whatever selection we build must preserve that pairing, and it is the most likely source of subtle bugs.
- **Summarize with which model.** The session's model is the obvious default; a cheaper one is tempting and risks a worse summary at exactly the moment the summary is load-bearing.
- **What the summary must preserve.** The user's actual goal, decisions already made, file paths and artifacts produced, and anything the user stated that is not recoverable from the filesystem. Worth writing the prompt against a real long transcript rather than in the abstract.
- **Whether compaction is reversible.** opencode keeps the original messages and hides them from assembly rather than deleting them. That is the safer default and makes the boundary a view rather than a destructive edit.

## Risks

- **Silent capability loss.** The agent forgetting a constraint the user set fifty turns ago is worse than a visible failure, because neither party notices. The summarization prompt is the highest-leverage and least testable part of this feature.
- **Interaction with prompt caching.** [add-cache-control.ts](../../../packages/workspace/src/lib/add-cache-control.ts) places cache breakpoints over the assembled messages. Compaction rewrites the prefix, which invalidates the cache for that turn by construction. Expected and acceptable, but it should be understood rather than discovered.
- **Estimation error.** An estimator that runs low compacts too late and the request still fails; too high and it compacts needlessly. Reactive triggering is the safety net for the first case, which is an argument for building phase 5 rather than treating it as optional.
- **Tool-call pairing.** See above. Deserves its own tests.
