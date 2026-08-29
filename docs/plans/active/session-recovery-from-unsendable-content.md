# Recovering a session whose history the provider will not accept

Status: **in progress**. Owner: TBD. Prevention and classification have landed (phases 1 and 4, see "What already exists"). Recovery has not, but phases 2 and 3 are unblocked: "Relationship to context compaction" ends with the two plans proceeding independently.

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

Landed with the image work (see [image-zoom-for-fine-detail.md](../completed/image-zoom-for-fine-detail.md)):

- [normalize-model-images.ts](../../../packages/workspace/src/lib/normalize-model-images.ts) runs over every outgoing message on every turn. It resizes over-budget images, corrects a media type the bytes contradict, and drops undecodable bytes with a text note rather than sending them. Because it runs over the whole history and not just new messages, **it is already a repair pass**: a session poisoned before a fix ships gets repaired the next turn the fix is deployed. That property is worth protecting deliberately rather than keeping by accident.
- [sanitize-model-text.ts](../../../packages/workspace/src/lib/sanitize-model-text.ts) strips unpaired surrogates from outgoing text, including the text a tool returned, and `truncateWithoutSplitting` stops `read_file` from creating them. Tool results were skipped until [the coordinate contract review](../completed/image-read-coordinate-contract.md) caught it, which is worth remembering: the pass had a doc comment claiming it covered everything, and the gap was in the role carrying the most text we did not write.
- `read_file` refuses an undecodable image up front, so the failure lands in one tool result the agent can act on.
- [probe-media.ts](../../../packages/workspace/src/lib/probe-media.ts) extends that refusal to the other media kinds: `isReadablePdf` checks that a PDF has both its header and its end marker, and `canDecodeMedia` runs ffprobe over an audio or video file. `read_file` returns `undecodable-pdf` or `undecodable-media` rather than handing the bytes on. ffprobe failing to _start_ counts as no evidence and lets the read through, since refusing every video because a binary is missing is the worse failure.
- [classify-provider-error.ts](../../../packages/workspace/src/lib/classify-provider-error.ts) names a rejection: `auth`, `context-overflow`, `rate-limit`, `transient`, `unsendable-content`, or `unknown`. Nothing acts on it yet. It is attached to the `llm.error` event alongside the evidence layer that produced it, so which rejections actually arrive is a number rather than a guess.

That covers causes 1 through 4 wherever the bytes can be decoded locally, and by construction it cannot cover cause 6.

One gap left deliberately. The media-type-contradicts-the-bytes check is images only: ffprobe reports a container as a comma-separated list of names (`mov,mp4,m4a,3gp,3g2,mj2`), which does not map onto a media type cleanly enough to call a mismatch a lie.

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

### Phase 1: a typed classifier -- landed

1. `classifyProviderError` takes the caught error and answers with a kind plus the evidence layer that decided it. The kinds live in `packages/shared` because telemetry records them too.
2. Evidence is weighed by durability, with one change from the sketch below. The status code goes first only where it is decisive on its own -- 401/403, 429, 413 -- because a 429 that happens to say "too many tokens" is throttling, and settling that structurally beats excluding it by pattern. Then `error.code` / `error.type` out of the response body. Then prose, behind the exclusions list. `isRetryable` is consulted last, as the SDK's own verdict on what is worth retrying.
3. The body is read field by field rather than validated as a whole: `error` is a bare string for some providers and `code` is a number for others, and a schema strict enough to reject those shapes would throw away the siblings that did parse.
4. The prose lists are sourced, not ported. Five patterns for unsendable content and eighteen for overflow, each carrying the provider and the example message it came from, and each for a provider in `AIProviderTypeSchema`. Patterns for providers we do not ship against were left out; the module exists so there is one place to add one when a real failure turns up.
5. `it.each` over recorded error bodies, one case per provider and one for each way the evidence ordering could go wrong.

### Phase 2: degrade and retry

6. On a classified `unsendable-content` or `context-overflow` error, if the outgoing payload contained media, retry the request once with all media replaced by placeholders naming the file and media type.
7. Two outcomes, and they are both informative. The stripped retry succeeds, which proves media was the cause. Or it fails the same way, which proves it was not, and the original error is reported as today.
8. This is a bisect with a single probe. It costs one extra request, only on a permanent failure, only when media is present. Do not build a full bisect over individual parts until there is evidence one probe is insufficient.
9. Hook point: the error path in [llm-request.ts](../../../packages/workspace/src/logic/llm-request.ts) or the `onError` transition in [agent.ts](../../../packages/workspace/src/machines/agent.ts). `streamText` is already called with `maxRetries: 0` because retries are handled outside it, so the machine is the natural owner. Note that the machine sees the persisted `metadata.error` record rather than the live error, so it needs an entry point onto the same classifier that takes those fields.

### Phase 3: make the repair stick

10. When the stripped retry succeeds, record it. A flag on the offending parts is better than deletion: the transcript still shows something was there, and `Store.removeMessage` ([store.ts:367](../../../packages/workspace/src/lib/store.ts#L367)) is a blunter tool than this needs.
11. `normalizeModelImages` (and its future siblings) skip flagged parts, so later turns neither send nor re-probe them.
12. Surface it in the transcript. The user should see that an attachment could not be sent, and the model should be told too, so it can say so rather than behaving as though the image were still there.

### Phase 4: close the remaining prevention gaps -- landed

13. PDF, audio, and video are checked before they leave `read_file`, in [probe-media.ts](../../../packages/workspace/src/lib/probe-media.ts). See "What already exists" for what each check does and for the media-type gap it does not close.
14. A small image file declaring enormous dimensions is refused from its header, before anything decodes it. That is [the coordinate contract review](../completed/image-read-coordinate-contract.md)'s item 3, and it serves this plan's cause 1 as much as that one.
15. The fixed-index audit came back clean. `truncateHead`, `truncateTail`, and `truncateMiddle` cut between lines, and the one path that cuts inside a line walks to a UTF-8 lead byte first. That path fails differently from the surrogate case -- a `Buffer` decode substitutes U+FFFD rather than leaving a half character -- so the test asserts both: nothing a sanitizer would strip, and no replacement character.

## Relationship to context compaction

These two plans share a foundation and an escalation path, and should be sequenced deliberately.

- Both need phase 1's classifier. It exists; [context compaction](context-compaction.md) should consume it rather than growing its own overflow check.
- opencode's recovery for oversized payloads is compaction with media stripped, so an earlier draft expected phase 2 here to become a mode of compaction rather than a separate degrade path. That no longer holds. [Context compaction](context-compaction.md) now follows codex, whose compacted history discards tool and assistant content wholesale and retains user messages verbatim, media included. It never produces a media-stripped view of the same history, so phase 2 keeps its own degrade path.
- Remaining order: phases 2 and 3 here no longer wait on compaction, and the two plans can proceed independently.

## Risks and open questions

- **A probe that masks a real bug.** If stripping media makes a request succeed, the media was wrong, and the interesting question is why we produced it. Every successful probe should be an event we can count, not just a silent recovery.
- **The classifier drifting.** Mitigated by ordering structured evidence first and by keeping prose patterns evidence-driven. It will still drift, which is why the evidence layer is recorded next to the verdict: a mix shifting from `structured` toward `prose`, or toward `none`, is what drift looks like from the outside.
- **Model switching mid-session.** A user can switch to a model with different limits or no vision at all. Per-turn normalization already recomputes against the current model, and `filterUnsupportedMedia` handles the capability case, so this should be covered; it needs a test rather than new code.
- **Deciding what "media was present" means** for the probe. Simplest useful definition is any file or media part in the outgoing messages.
