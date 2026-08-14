# No always-on budget across one step's tool results

Date: 2026-08-12

## Decision

Tool results are bounded per call, and a per-call bound applies wherever a result is rendered for the model, replay included, so that a session which recorded an oversized result stops paying for it. There is no second budget that a single assistant step's results share.

When we do need to bound a whole request, it goes in the context-fit path keyed to the model's actual window, not in a fixed constant applied unconditionally. [The plan](../plans/completed/tool-result-context-budgets.md) has the audit that raised the question; [context compaction](../plans/active/context-compaction.md) is where the fit belongs.

## What was built and reverted

A working per-step budget, with tests: results belonging to one assistant step shared 32 KB of text, allocated max-min so short results stayed whole and the last result could not be starved by the first, with content replaced in place so every tool call kept its result. It was removed before merge. `allocateFairShare` survives because the per-search budget uses it.

## Why

Four production agent harnesses were read for prior art, two Rust and two TypeScript. Every one of them bounds a single tool result: 40 KB or 20,000 characters, or 2,000 lines and 50 KB, or a token budget converted to bytes. All of them spill the full output to a file and tell the model where it went. That is the shape we already had, and it is not in question.

The aggregate is where they diverge from what was built here, and they diverge the same way.

- Two of the four bound the **whole conversation** against the model's context window rather than any one step. One drops the oldest turns until the request fits, keeps the system prompt and the most recent turns, and only if the most recent turn alone still does not fit does it divide the remaining budget across that turn's tool results and truncate each in place, keeping the owning tool call so the pairing survives. The other summarizes instead of truncating, triggered by the same comparison of session tokens against usable context.
- One has a shared budget across several items in a prepared request, which is the same mechanism, but spends it on assistant text while assembling a sub-request for its search backend, and drains it front to back rather than fairly.
- None applies a fixed per-step ceiling on every request regardless of how much room is left.

So the mechanism is sound and independently arrived at elsewhere: divide a budget across one step's results, replace content in place, never drop a result. What was wrong here was the trigger. A fixed 32 KB fires identically on turn two of a session with a million tokens of room and on turn forty of one that is nearly full, which means it pays a cost in every session to protect the few that were at risk.

The audit that motivated it also does not describe an overflow. The worst case found was one step growing a request by 25,896 tokens, and a session reaching 81,000 input tokens before it began answering. Nothing hit a limit. That is cost and dilution, which compaction and retrieval guidance address, and treating it as an overflow bug bought:

- Trimming on ordinary research turns. A real run of three parallel fetches returned 55,714 characters and lost roughly 23,000 of them, with nothing at risk.
- Two parallel commands, each already within its own 20 KB cap, cut to 16 KB apiece.
- Results shrinking retroactively. The pass ran on every replay, so a result the model read whole in one turn could be shorter by a later one, with no way back to what it had already quoted.

## Consequences

- A step that makes many large calls at once can still spend a large fraction of the window. The per-call caps bound each one; nothing bounds the sum. That is accepted until the context-fit work lands.
- The trailing half of a trimmed result no longer needs preserving, so the tail-safe truncation helper that existed for it went too. Anything that trims a bounded block in future has to keep the block's closing marker, or every message after it reads as quoted page content.
- If the per-call caps turn out to be set too high, per-tool clip telemetry is the thing to read, not a step aggregate that no longer exists.
