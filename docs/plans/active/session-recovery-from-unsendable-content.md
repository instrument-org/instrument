# Recovering a session whose history the provider will not accept

Status: **proposed**. Owner: TBD. Prevention has partly landed (see "What already exists"); classification and recovery have not.

## Problem

One tool result the provider refuses ends a conversation permanently.

The mechanism is the combination of two reasonable decisions. Parts are persisted as they stream, so a tool result exists on disk before anything validates that it can be sent. And [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) rebuilds the whole transcript from the database on every turn, so that part is replayed on every later request. A rejection is therefore not one failed turn: every subsequent turn fails the same way, for the same reason, forever. There is no way back from inside the session, and no user-facing way to remove the offending part.

The rejection arrives as an `APICallError` and lands in the catch block at [llm-request.ts:640](../../../packages/workspace/src/logic/llm-request.ts#L640), which records it on the assistant message and stops. The retry machinery in [agent.ts](../../../packages/workspace/src/machines/agent.ts) is a chunk-timeout retry, not an error-class retry, so nothing reconsiders the payload.

Known ways to produce unsendable content:

1. **Media the provider cannot decode** -- a truncated download, a file whose bytes are not the format its name claims.
2. **A media type that contradicts the bytes.** `getMimeType` reads the file extension, so a CDN serving PNG under a `.jpg` name announces a contradiction.
3. **Media over the per-image size cap.**
4. **Unpaired UTF-16 surrogates in text**, which have no UTF-8 encoding. Produced by slicing a string at a fixed index through a non-BMP character.
5. **Payload over the context window**, which is the same shape of permanent failure and is [context compaction](context-compaction.md)'s problem.
6. **Anything a provider rejects that we have not thought of.** This is the category that matters, because the first five can be prevented and this one cannot.

## What already exists

Landed with the image work (see [image-zoom-for-fine-detail.md](image-zoom-for-fine-detail.md)):

- [normalize-model-images.ts](../../../packages/workspace/src/lib/normalize-model-images.ts) runs over every outgoing message on every turn. It resizes over-budget images, corrects a media type the bytes contradict, and drops undecodable bytes with a text note rather than sending them. Because it runs over the whole history and not just new messages, **it is already a repair pass**: a session poisoned before a fix ships gets repaired the next turn the fix is deployed. That property is worth protecting deliberately rather than keeping by accident.
- [sanitize-model-text.ts](../../../packages/workspace/src/lib/sanitize-model-text.ts) strips unpaired surrogates from outgoing text, and `truncateWithoutSplitting` stops `read_file` from creating them.
- `read_file` refuses an undecodable image up front, so the failure lands in one tool result the agent can act on.

That covers causes 1 through 4 for images and text. It does not cover PDF, audio, or video, and by construction it cannot cover cause 6.

## Prior art

Three harnesses, all public. Worth reading before choosing an approach, because two of them answer the "can this be classified?" question empirically.

### The cost of classifying errors by their message

Both mature harnesses maintain a large pattern list for exactly **one** condition, context overflow:

- opencode, `packages/llm/src/provider-error.ts` ([github.com/sst/opencode](https://github.com/sst/opencode)): 31 regex patterns plus a 3-pattern exclusion list.
- pi-mono, `packages/ai/src/utils/overflow.ts`: 25 patterns, each annotated with the example error string from the provider it matches, plus exclusions with a documented reason. Bedrock formats throttling as "Too many tokens, please wait", which false-positives the generic overflow pattern.

pi-mono additionally documents three providers where message classification **cannot work**: z.ai accepts overflow silently, Xiaomi MiMo truncates the input and returns `finish_reason: "length"` with zero output tokens, Ollama sometimes truncates silently. It detects those structurally instead, via `usage.input > contextWindow` and via "context full plus zero output".

The lesson is not that classification is wrong. It is that prose matching is a treadmill with no end state, so it belongs behind structured signals rather than in front of them, and anything that can be prevented should be prevented instead of classified.

Both projects centralize it: one shared module, one named error class carrying a `classification` field, one exclusion list. If we classify, that is the shape.

### codex: the cautionary version

`codex-rs/codex-api/src/api_bridge.rs` ([github.com/openai/codex](https://github.com/openai/codex)) matches a hardcoded English string from one provider:

```rust
} else if body_text.contains("The image data you provided does not represent a valid image") {
    CodexErr::InvalidImageRequest()
```

It then marks the error non-retryable and emits "Invalid image in your last message. Please remove it and try again." No recovery, and it assumes the bad image is in the most recent message. That is the bricked session with a politer error.

### opencode: the recovery loop worth borrowing

opencode already ships the degrade-and-retry idea, keyed on context overflow (which includes HTTP 413, the oversized-payload case):

1. Request fails, error is classified as `ContextOverflowError`.
2. `processor.ts` sets `needsCompaction` and returns `"compact"` rather than stopping.
3. Compaction runs with **`stripMedia: true`**, replacing each media part with a descriptive placeholder naming the file and its type (`[Attached image/png: photo.png]`), not a generic note.
4. A synthetic user message is injected explaining that media was removed, **so the model can explain it to the user** rather than being silently confused about a missing attachment.
5. The turn continues.
6. If compaction itself still overflows, it stops with "Session too large to compact - context exceeds model limit even after stripping media".

Three details to copy: the placeholder names what was removed, the strip is an option on the message-to-model conversion rather than a bespoke pass, and the model is told what happened.

## Goal

A session survives content the provider will not accept, without a human editing the database.

### Success criteria

- A task whose history contains a deliberately unsendable part completes a turn, having dropped only that part.
- The repair is permanent: the next turn does not re-probe and does not re-fail.
- The user is told, in the transcript, that something was removed and what it was.
- An error that is not about content is reported exactly as it is today, with no extra request spent.
- No behavior change and no extra requests on the happy path.

## Plan

### Phase 1: a typed classifier

1. New `packages/workspace/src/lib/classify-provider-error.ts`. Input is the caught error, output is a discriminated union: `context-overflow`, `unsendable-content`, `auth`, `rate-limit`, `transient`, `unknown`.
2. Order the evidence by durability. First the SDK's own typed verdict: `APICallError.isInstance(error)` gives `statusCode` and `isRetryable`, where `isRetryable` is the SDK's computed `408 | 409 | 429 | >= 500`. Then structured fields parsed out of `responseBody` (`error.code`, `error.type`) -- opencode matches `context_length_exceeded` this way before falling back to prose, and structured codes do not rot the way messages do. Only then prose patterns, each annotated with the provider and example message it came from, behind an exclusions list.
3. Keep the prose list small and honest. Do not port all 31 of opencode's patterns speculatively; add one when a real failure is seen, with its example string in a comment. The point of the module is that there is one place to add it.
4. Unit tests are the natural fit for `it.each` over recorded error bodies.

### Phase 2: degrade and retry

5. On a classified `unsendable-content` or `context-overflow` error, if the outgoing payload contained media, retry the request once with all media replaced by placeholders naming the file and media type.
6. Two outcomes, and they are both informative. The stripped retry succeeds, which proves media was the cause. Or it fails the same way, which proves it was not, and the original error is reported as today.
7. This is a bisect with a single probe. It costs one extra request, only on a permanent failure, only when media is present. Do not build a full bisect over individual parts until there is evidence one probe is insufficient.
8. Hook point: the error path in [llm-request.ts](../../../packages/workspace/src/logic/llm-request.ts) or the `onError` transition in [agent.ts](../../../packages/workspace/src/machines/agent.ts). `streamText` is already called with `maxRetries: 0` because retries are handled outside it, so the machine is the natural owner.

### Phase 3: make the repair stick

9. When the stripped retry succeeds, record it. A flag on the offending parts is better than deletion: the transcript still shows something was there, and `Store.removeMessage` ([store.ts:367](../../../packages/workspace/src/lib/store.ts#L367)) is a blunter tool than this needs.
10. `normalizeModelImages` (and its future siblings) skip flagged parts, so later turns neither send nor re-probe them.
11. Surface it in the transcript. The user should see that an attachment could not be sent, and the model should be told too, so it can say so rather than behaving as though the image were still there.

### Phase 4: close the remaining prevention gaps

12. Extend byte-level validation to PDF, audio, and video in [read-file.ts](../../../packages/workspace/src/tools/read-file.ts). They are sent as media with only a size cap and no format check, so a corrupt PDF bricks a session exactly the way a corrupt image used to.
13. Audit other paths that slice strings at fixed indices, the way `read_file`'s long-line cap did before `truncateWithoutSplitting`. Tool output truncation in [truncate-buffer.ts](../../../packages/workspace/src/lib/truncate-buffer.ts) is safe today because it works line by line, but the property is worth a test rather than an inspection.

## Relationship to context compaction

These two plans share a foundation and an escalation path, and should be sequenced deliberately.

- Both need phase 1's classifier. Build it once, here, and have [context compaction](context-compaction.md) depend on it.
- opencode's recovery for oversized payloads **is** compaction with media stripped. If compaction lands first, phase 2 here becomes a mode of it rather than a separate degrade path, which is less code and one fewer concept.
- Recommended order: phase 1 here, then compaction, then phases 2 and 3 here built on top of compaction's stripping and history-rewriting machinery. Phase 4 is independent and can land any time.

## Risks and open questions

- **A probe that masks a real bug.** If stripping media makes a request succeed, the media was wrong, and the interesting question is why we produced it. Every successful probe should be an event we can count, not just a silent recovery.
- **The classifier drifting.** Mitigated by ordering structured evidence first and by keeping prose patterns evidence-driven. It will still drift.
- **Model switching mid-session.** A user can switch to a model with different limits or no vision at all. Per-turn normalization already recomputes against the current model, and `filterUnsupportedMedia` handles the capability case, so this should be covered; it needs a test rather than new code.
- **Deciding what "media was present" means** for the probe. Simplest useful definition is any file or media part in the outgoing messages.
