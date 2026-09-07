# Killing a degenerate stream loop

**Status:** proposed, 2026-09-07. Nothing built. The detector below is calibrated against 289 real eval sessions and the separation is decisive; what needs a decision before writing code is the response policy and whether the same turn is retried or handed back.

## What actually happens

GLM 5.3 Flash, asked for a spreadsheet, produced this for 686 seconds:

```
… — **Loading the spreadsheet skill** — I need to load the spreadsheet skill first.
— `load_skill` spreadsheet — `start_activity` — **Loading the spreadsheet skill**
— I need to load the spreadsheet skill first. — `load_skill` spreadsheet — …
```

165,000 characters, a unit repeating roughly every 110, degenerating by the end into `tool placeholder — tool placeholder — tool placeholder`. It emitted no tool call and wrote no file.

Observed twice in 233 GLM sessions (~1%), and not in 54 Luna or 24 Qwen sessions — denominators too small to call it GLM-specific, but the shape is consistent across all four instances captured.

## Why nothing we have catches it

The whole event is **one assistant message inside one step**, which is what defeats every existing guard:

| Guard | Why it misses |
| --- | --- |
| `maxStepCount` | The loop never finishes a step, so the count never advances. |
| `llmRequestChunkTimeoutMs` (5 min, `machines/agent.ts`) | Resets on every stream part, and parts keep arriving the whole time. |
| `--max-run-tokens` / any token cap | Usage lands when an assistant message is saved. An aborted message never saves, so the meter reads zero. |
| Provider `finishReason` | The provider is behaving; it is sampling exactly what it was asked for. |
| Wall clock (`--max-run-seconds`) | Catches it, eventually, by killing the whole run. This is the only thing that currently ends it. |

So the cost is paid in full every time: minutes of wall clock, tens of thousands of output tokens, and a task that produced nothing.

## What other harnesses do

- **opencode** ships a step cap that, on the last step, disables tools and injects a prompt demanding a text-only summary of what was done. Bounding "repeated identical tool calls" is an explicit unchecked TODO in their v2 runner, so the trajectory-level case is acknowledged and unsolved there too.
- **prime-agent** carries an open issue for exactly this failure (`"The the the..."` until manual abort). The proposed fix is a stream-level detector at the `stream()` dispatch chokepoint, combining a rolling verbatim-tail check with near-duplicate clustering, which on a hit aborts the upstream request and emits a **retryable** empty-content error so the existing auto-retry re-samples and nothing garbage reaches the transcript.
- **SIMURG** is a standalone library for the same job against any OpenAI-compatible API. Two ideas worth taking: re-check on a fixed character cadence rather than per token, and require hysteresis (two consecutive hits) so one noisy checkpoint cannot kill a good answer. It also holds the first ~350 characters so a stream corrupt from the start never reaches the UI — which we should **not** copy, because it delays first paint and we spent real effort getting median time-to-first-token to 4.9s.
- **SpecRA** (randomized projection + FFT autocorrelation) is the research answer for approximate and structural loops that exact n-gram matching misses, in O(N log N). Over-engineered for what we have, and worth remembering only if a real loop ever slips past the cheap detector.

The consistent shipped answer is: detect in the stream, abort, emit something retryable, and let the existing retry path handle it. Nobody kills the agent outright.

## The detector

Compression ratio over a rolling window of the message's own streamed text. Degenerate text is almost pure redundancy and `deflate` prices it accordingly.

Measured over every 8KB window of every assistant message in all 289 eval sessions on disk:

| | Worst 8KB window compresses to |
| --- | --- |
| The four captured loops | **0.8% – 1.0%** |
| Worst legitimate session (Luna writing python-pptx for a deck) | 13.4% |
| Next four legitimate | 17.1% – 20.7% |
| Median session | 38.8% |
| Highest | 45.6% |

A threshold at **5%** sits in a gap with 5x headroom above the loops and 13x below the worst honest text. Nothing in the corpus is anywhere near it. Two hits in a row before acting, per the hysteresis note above.

Chosen over the alternatives because it is parameter-light and catches drift for free: this loop alternates between `load_skill spreadsheet` and `load_skill — spreadsheet skill`, which breaks a verbatim tail comparison and does not trouble a compressor. A rolling shingle-hash count would also work and would be cheaper still; compression wins on having one knob instead of three.

Cost is negligible: one `deflateSync` over 8KB every 4KB of streamed text, against a stream already doing per-part work.

## Where the code goes

Three files, one of them new.

- **`src/logic/stream-degeneration.ts`** (new). Pure, no I/O: a small class that takes text deltas and answers `isDegenerate()`. Unit-tested directly against the captured transcripts, which is why it must not know anything about streams or actors.
- **`src/logic/llm-request.ts`**. The `for await (const part of result.fullStream)` loop at line 327 is the chokepoint every provider path already goes through, and it is where `llmRequest.chunkReceived` is already sent. Feed `reasoning-delta` (line 415) and `text-delta` (line 534) into the detector; on a trip, abort through the same `signal` the loop already checks at line 328 and send a new `llmRequest.degenerated` event.
- **`src/machines/agent.ts`**. Handle `llmRequest.degenerated` beside the chunk timeout's `raise({ type: "retry" })` at line 705. That reuses `maxAttemptCount` (3), the existing abort plumbing, and the existing retry accounting, so a loop costs one attempt rather than a special case.

Reusing the retry path is the point. When the attempts are spent it becomes an ordinary failed turn, and for a task under an orchestrator the recovery already exists and is captured working: the conversation reads the task's log on the second overdue wake, stops it, starts a fresh one, and tells the user why.

## What needs deciding before this is written

1. **Retry the same request, or change something first.** Re-sampling at the same temperature may loop again. Options: retry unchanged (simplest, and the loop is rare enough that three tries is probably plenty), retry with the reasoning level dropped a notch, or retry with the partial text appended as an assistant turn saying it repeated itself. No data on which works, and getting it needs a reproducer.
2. **Whether the user sees it.** The repetition is streaming to the screen while it happens. Silently swallowing and retrying is cleaner if the retry works, and confusing if the text visibly rewinds. A one-line status is probably right, but it is a UI call.
3. **Whether to also bound repeated identical tool calls.** A different failure with the same smell — an agent calling the same tool with the same arguments forever — and the one opencode has open. Not observed in our corpus, so this proposes nothing; worth a counter if it shows up.
4. **Telemetry first.** 233 sessions is a thin base rate. Shipping the detector in report-only mode for a while, counting trips through `captureEvent` without aborting, would say whether 5% is right in production before it can cost anyone a turn.
