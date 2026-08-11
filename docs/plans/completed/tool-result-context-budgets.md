# Bound tool results before they consume the context window

Status: **complete**. All three phases landed: the per-search budget in [web-search.ts](../../../packages/workspace/src/tools/web-search.ts), the per-step budget in [budget-step-tool-results.ts](../../../packages/workspace/src/lib/budget-step-tool-results.ts), and the lower fetch default. Kept for the audit evidence and the reasoning behind the numbers, which the code does not state; where the implementation went a different way, "As built" at the end says so.

## Problem

Instrument limits several individual tool results, but it does not limit their combined model-visible size. [bash.ts](../../../packages/workspace/src/tools/bash.ts) keeps a 10 KB head and 10 KB tail and saves the full output to a spill file, [web-fetch.ts](../../../packages/workspace/src/tools/web-fetch.ts) returns at most 50,000 characters and spills the rest, [read-file.ts](../../../packages/workspace/src/tools/read-file.ts) caps text reads at 50 KB, and [skills.ts](../../../packages/workspace/src/lib/skills.ts) caps an inlined skill body at 40,000 characters. Those limits apply per call. A model can issue several calls in one assistant step, and [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) replays all transformed results without a combined budget.

`web_search` is the clear individual gap. [web-search.ts](../../../packages/workspace/src/tools/web-search.ts) renders every returned excerpt or the entire search-model summary, followed by every source, with no local character ceiling or spill behavior. The platform currently tends to return six excerpts per call, but that upstream behavior is not a context contract.

A read-only audit of recent production and development task databases found:

- 20 adjacent model calls whose input grew by at least 10,000 tokens.
- The largest single increase was 25,896 tokens after five `web_search` calls in one assistant step.
- Two production research sessions each issued four searches and then five searches in consecutive steps, growing one session from roughly 14,000 to more than 81,000 input tokens before it began writing its answer.
- One five-search batch included an exact `noop` query. It still reached the backend and returned 12,441 stored characters.
- A 50,000-character `web_fetch` result correctly spilled, but the retained prefix plus one search still increased the next request by 12,299 tokens.
- Large bash and browser outputs were persisted in full but showed next-request growth consistent with the 20 KB model-visible cap. Multiple capped bash results still stacked when requested in one step.
- Batched text reads and image reads created smaller, explainable increases. No individual `read_file`, skill, or media cap bypass was found.

The database stores full tool results for the transcript and UI, so persisted byte size is not evidence that all of it reached the model. The audit correlated each assistant message's reported input tokens with the preceding assistant step and its tool parts. The implementation should preserve that distinction: retain full persisted output while bounding only the representation replayed to the model.

## Goal

One broad retrieval call or one assistant step containing several tool calls cannot unexpectedly spend a large fraction of the context window, while the agent keeps enough result metadata to continue deliberately.

### Success criteria

- A single local `web_search` has a named, tested model-visible character budget.
- A group of text tool results belonging to one assistant step has a named, tested aggregate character budget.
- Every tool call still has a corresponding tool result. Budgeting never drops a result message or breaks provider tool-call pairing.
- Source titles and URLs survive search truncation so the agent can fetch the specific pages it needs.
- Truncation is explicit and says how to retrieve more detail. The model never mistakes a clipped result for the complete result.
- Full persisted output and current transcript/UI behavior remain available for debugging.
- Replaying a task created before this change applies the new limit, so an existing oversized search result cannot keep poisoning later turns.
- Results below the budgets are byte-for-byte unchanged at the model-output boundary.
- Numeric telemetry makes future context audits possible without recording retrieved content.

## Phase 1: cap local web-search output

Apply the limit in `WebSearch.toModelOutput`, after [readWebSearchResults](../../../packages/workspace/src/lib/web-search-results.ts) has normalized current or legacy persisted output and before `boundContent` constructs the untrusted-content boundary. Capping only the platform response or stored value would not repair existing sessions on replay.

1. Add a named character budget for the model-visible search body. Start with 16,000 characters, including excerpt or summary text but excluding the fixed safety preamble and source-title/URL list. Keep the constant local until another tool has a demonstrated need for the same policy.
2. For excerpt results, retain every source title, URL, author, and publication date. Allocate the text budget fairly across sources so one long first excerpt cannot erase the remaining results. Short excerpts remain whole and unused capacity is redistributed to longer excerpts.
3. For summary results, truncate the generated summary on a Unicode-safe boundary and retain the complete source list.
4. Add an explicit note inside the content boundary stating that excerpts were shortened and that `web_fetch` should be used on a named source when more detail matters.
5. Keep the complete output in the persisted part. A search spill file is unnecessary for the first implementation because the source URLs are the durable path to the underlying content; do not add another task artifact unless real use shows that exact omitted excerpts must be recoverable.
6. Short-circuit an exact, case-insensitive `noop` query before calling the backend. Return a small error result telling the model that no search was performed because the query did not name a topic. Do not grow a speculative placeholder list without observed examples.
7. Audit provider-executed hosted search separately. Do not assume that limiting Instrument's portable `WebSearch` transformation also limits content a provider inserts for its own hosted tool.

## Phase 2: cap the combined text returned by one assistant step

A per-search limit alone leaves the observed five-search pattern able to stack five maximum-sized results. Add an aggregate model-visible text budget after tool-specific `toModelOutput` transformations and before messages are handed to the provider.

1. Introduce a provider-neutral character budget for text tool results produced by one assistant message. Start at 32 KB, which permits one full capped bash result plus useful output from another call without allowing five retrieval calls to consume an open-ended amount of context.
2. Group tool results by the assistant message containing their tool calls. Apply a deterministic fair-share algorithm: retain short results whole, divide the remaining budget among longer results, and redistribute unused shares. Preserve each result's beginning and its tool-specific truncation or spill notice where one exists.
3. Replace omitted text with a small result-local notice rather than removing the result. The notice should name the original character count, the retained character count, and the available recovery path: an existing spill file, a narrower rerun, pagination, or `web_fetch` of a retained source URL.
4. Limit text first. Images already pass through provider-specific normalization and have materially different accounting; add a per-step image or pixel budget only if a separate audit shows an actual failure.
5. Apply the aggregate pass during every replay, not only when a tool finishes, so it repairs persisted sessions and remains independent of which provider executes the next turn.
6. Keep this budget separate from [context compaction](../active/context-compaction.md). Tool-result budgeting prevents one step from consuming the window; compaction handles useful history accumulated over many steps.

## Phase 3: reduce the default web-fetch prefix

This is evidence-backed but not required to land the web-search fix. The current 50,000-character value is a useful explicit maximum and a large default. A single product page hit it during the audit and added roughly 12,000 tokens when combined with one search.

1. Change the default `maxCharacters` from 50,000 to 20,000 while retaining 50,000 as the schema maximum for an explicit request.
2. Keep the existing spill file behavior and tell the agent it can request a larger prefix or read the spill file when the first 20,000 characters are insufficient.
3. Measure whether agents immediately repeat fetches at 50,000. If they do, improve the retrieval guidance or add focused extraction rather than silently lowering the cap again.

No current evidence justifies lowering `read_file`, skill-content, bash, or image limits. The aggregate phase covers their stacking behavior without making ordinary single calls less useful.

## Telemetry

Record one event whenever either budget clips model-visible content. Include only numeric and structural fields: tool name, result count in the assistant step, original characters, retained characters, per-result versus aggregate reason, whether a spill path existed, provider, and model identifier. Do not record commands, queries, excerpts, URLs, file paths, or output text.

The event should distinguish `web_search`'s own limit from the step aggregate limit. Otherwise a later audit cannot tell whether the individual budget is too high or whether the model is batching too many otherwise reasonable calls.

## Validation

1. Add focused `web-search.test.ts` cases for excerpt and summary results below and above the budget, fair allocation across sources, complete source metadata, Unicode-safe truncation, the untrusted-content boundary, legacy persisted shapes, and the exact `noop` short circuit.
2. Add model-message preparation tests with several tool calls in one assistant message. Cover all-short results, one dominant result, several maximum-sized results, mixed tools, existing spill notices, multipart output, and preservation of tool-call/result pairing.
3. Verify that full outputs remain persisted while the model-visible form is bounded.
4. Reproduce the five-search shape with synthetic results and prove that its combined text stays within the aggregate budget.
5. Run the focused Workspace tests, then Workspace type and lint checks through Turbo. A real-session smoke test should query the resulting task database and confirm that the next assistant call's reported input-token increase is consistent with the configured character budget.

## Risks and decisions

- **Character budgets are only token approximations.** This matches the existing project-instruction, skill, fetch, file, and bash policies and is provider-neutral. Reported provider usage remains the authority for validating the chosen numbers.
- **Truncating search excerpts can hide the useful passage.** Fair allocation, complete source URLs, and explicit follow-up guidance reduce this risk. Do not keep only a global head of the concatenated result.
- **Aggregate budgeting can hide a late result.** Fair sharing is required. A first-come budget would reward whichever tool happened to execute first and could make the last result useless.
- **Provider tool protocol is strict.** Replace content inside every result; never drop or reorder tool result messages.
- **Hosted search may follow a different replay path.** Cover it with an explicit test or record it as not governed by this plan rather than claiming a universal limit.
- **Budgets can become magic constants.** Name them, explain their intended context cost, emit truncation telemetry, and adjust from observed usage instead of adding provider-specific guesses.

## As built

Five things came out differently from the plan above.

- **A trimmed step result keeps a tail, not only a head.** Several tools put the thing that makes a partial result recoverable at the end: the path a spilled output was written to, and, for anything delivered inside a content boundary, the marker that closes the block. A head-only cut would drop that marker and leave every later message reading as quoted page content, so the last 512 characters are retained alongside the head, with the omission notice between them.
- **The clipping telemetry omits `had_spill_path`.** The step pass sees transformed text and cannot tell whether a spill file exists behind it, and `web_search` deliberately has none, so the field would have been either a guess or a constant `false`. The event carries tool name, which limit clipped, original and retained characters, the step's result count, provider, and model.
- **The step limit reports only the step that just ran.** An earlier step is clipped identically on every later request, so counting all of them would have made the totals a function of session length rather than of how often the budget binds. `web_search`'s own limit is counted when the search finishes, for the same reason: `toModelOutput` runs on every replay.
- **The placeholder query gets its own `errorType`, `invalid-query`.** It is not a backend failure and has no provider guard in the UI, so it reads as an ordinary tool error with a message naming what to do instead.
- **Provider-executed search is out of scope, and the code says so.** A hosted result rides on the assistant message rather than in a `tool` message, so the step pass never sees it. That is asserted by a test rather than left to be discovered.

Both budgets are allocated by [allocateFairShare](../../../packages/workspace/src/lib/fair-share.ts), which is the same max-min split in both places: short pieces stay whole, and what they do not use goes back to the long ones.

## Related

- [Context compaction](../active/context-compaction.md) handles accumulated session history after preventive limits have done their job.
- [Session recovery from unsendable content](../active/session-recovery-from-unsendable-content.md) covers provider rejection and repair rather than ordinary oversized-but-valid tool output.
- [web-search.ts](../../../packages/workspace/src/tools/web-search.ts) owns the portable search model-output transformation.
- [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) is the canonical replay path where a same-step aggregate policy must hold.
