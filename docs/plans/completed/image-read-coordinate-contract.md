# Making the image coordinate contract sound

Status: **complete**. Owner: TBD. Corrections to the work described in [image-zoom-for-fine-detail.md](image-zoom-for-fine-detail.md), from a review of that branch. Everything here was agreed as a real defect, and all five have landed.

## The through-line

The region read rests on one promise: **the pixel space we name in text is the pixel space the model is looking at.** Break that and a crop silently returns the wrong part of the picture, which is worse than not having the feature, because a confidently wrong magnified view reads as evidence.

Three separate defects broke that promise, and they shared a cause. The annotation and the bytes were produced in different places, at different times, against different inputs: `read_file` computed and persisted dimensions at tool-call time, while [normalize-model-images.ts](../../../packages/workspace/src/lib/normalize-model-images.ts) re-rendered the bytes at send time, every turn, without touching the text that described them. `read_file` now produces both together, so there is no longer a gap for them to drift across.

## 1. The announced view can disagree with the bytes sent -- landed

**P1.** `read_file` computed `viewWidth`/`viewHeight` from the model active during the tool call and persisted them. `toModelOutput` renders the text from those persisted values. The bytes are then resized independently on each later turn. Two ways they diverge:

- **A model switch.** The annotation was computed for model A, the bytes are rendered for model B. Whenever their budgets differ the model is told A-sized coordinates while looking at B-sized pixels.
- **The byte-cap shrink**, which needs no model switch at all. `renderImage` walks down an encoding ladder and then shrinks the target by 25% when nothing fits the byte cap, so the image it returns can be smaller than the target it was asked for. The annotation still names the target.

The second is the more likely of the two and was not considered when this was built.

### What to do

A **fixed preview size**, `PREVIEW_LIMITS` in [image-view-size.ts](../../../packages/workspace/src/lib/image-view-size.ts), independent of provider and model, and `read_file` renders the bytes it announces.

- `previewImage` produces the preview and reports the size **measured off the encoded result**, not the size it asked for. That closes the byte-cap gap at its source rather than by agreement, and `renderImage` now carries a test that the dimensions it reports are the dimensions it produced.
- An image already inside the budget still passes through byte for byte. Worth stating as a rule rather than an accident: re-encoding it would soften exactly the hairlines and small text a region read exists to make legible, and there is nothing to gain when the file is already the size the model sees.
- Provider-level `imageView` is gone from [provider-metadata.ts](../../../packages/ai-gateway/src/schemas/provider-metadata.ts). With one budget for everything, `normalizeModelImages` no longer needs a model at all, so that parameter is gone too -- a good sign the abstraction was carrying nothing.
- A render that cannot produce a viewable copy is now a tool error telling the agent to convert or downscale, rather than a silent fallback to bytes the announcement does not describe.

The reviewer's structural note and this defect were the same argument. `imageView` was speculative -- every provider sat at the same floor, the real capability is per-model, and for routed providers (`openrouter`, `vercel`, our own gateway) the provider name says nothing about which model serves the request. Raising it per model later would have reintroduced this exact bug, since the coordinate space would again depend on which model was active. Revisit only with a different answer to coordinate stability in hand, not merely better numbers.

The cost is that a model with a larger budget no longer sees more of the image on first look. That capability was already given up when every provider was set to the floor, and the region read recovers the detail from the original file, which is the entire point of the feature.

Two tests hold the contract down, both stated as properties rather than as expected numbers: the bytes in a result measure exactly the view that result announces, and two different models produce identical output for the same file.

## 2. The documented recursive zoom is wrong -- landed

**P1.** The tool description told the model it could narrow further by reading a region "of what you get back". It could not. Every region is interpreted against the view of the **original** image, so coordinates read off a magnified crop land somewhere unrelated.

One correction to the review: only the tool description carried this, in both the tool text and the `region` parameter's own description. The agent prompt in [main.ts](../../../packages/workspace/src/agents/main.ts) says only "read the image again with `region` set to that area", which is true as written.

### What to do

Both descriptions now say coordinates are always in the whole image as first shown, never in a magnified crop, and point at the rectangle each response repeats as the thing to subdivide. The model can still narrow; it just expresses the narrower rectangle in whole-image coordinates.

Composed provenance (each crop remembering its parent rectangle, transforms multiplied through) is the more capable version and matches how the source cookbook describes the workflow. It is a real feature with real state, not a wording fix. Treat it as a follow-up and only build it if the eval shows the model struggling to subdivide in whole-image coordinates.

## 3. Byte size does not bound decoded pixels -- landed

**P1.** The branch removed the 8000px dimension guard and raised the byte ceiling to 50 MB, with a comment claiming the byte cap guards against decoding something pathological into memory. That comment was wrong, and being wrong in a comment is worse than being absent, because it tells the next reader the hazard is handled.

Compression ratio is unbounded for synthetic images. A small PNG of a solid color can declare dimensions large enough to allocate gigabytes when decoded, before any scaling happens.

One thing the review overstates: the decode happens in ffmpeg, a subprocess, so a bomb exhausts that process and `renderImage` returns undefined rather than taking the app down. The hazard is wasted time and host memory pressure, not a crash of ours. The guard is still worth having, because the dimensions are already in hand and the refusal is free.

### What to do

`MAX_DECODED_PIXELS` (200M) and `exceedsDecodeBudget` in [render-image.ts](../../../packages/workspace/src/lib/render-image.ts), checked from header dimensions before anything decodes. A 12000x12000 archival scan is 144M and passes.

Enforced in `renderImage` itself, which is the only place a decode begins, so it holds for a caller that never checked. It measures the source rather than taking a size as an argument: a size a caller passes is a size a caller can get wrong. An unmeasurable source is still handed to ffmpeg, which reads formats `image-size` cannot.

The two callers check as well, not for enforcement but to name the cause. `read_file` refuses with an `image-too-large` reason, which keeps the part out of the transcript entirely rather than merely out of one render. `normalizeModelImages` drops with a note saying to downscale and re-attach, for images that never went through `read_file` -- a user upload, a generated image, or a session recorded before the check existed. The misleading comment now says what the byte cap actually bounds.

The tests build a bomb as a 33-byte PNG header (`pngHeaderBytes`) rather than asking ffmpeg to paint 16000x16000, which would spend exactly the resources the guard refuses. The `renderImage` test asserts ffmpeg was never invoked, since returning undefined proves nothing on its own -- header-only bytes would fail a decode anyway.

## 4. Text sanitation skips tool output -- landed

**P1.** [sanitize-model-text.ts](../../../packages/workspace/src/lib/sanitize-model-text.ts) returned every `tool` message unchanged, while its own doc comment claimed it strips unpaired surrogates from every outgoing text part. Tool results are where file contents and command output reach the model, so the pass missed the largest source of the problem it exists to solve. The `read_file` truncation fix protects one producer; every other tool was unprotected.

### What to do

Tool result output is sanitized in all three text-bearing shapes -- `text`, `error-text`, and the text entries inside `content` -- on `tool` messages and on the assistant messages that carry a provider-executed result. The doc comment now states what is covered instead of claiming everything.

`json` and `error-json` are deliberately skipped, and the comment says why: `JSON.stringify` escapes a lone surrogate as `\uXXXX` rather than emitting it raw, so it cannot break the request's encoding the way a bare string can. No tool returns that shape today.

Four passes used to walk the `ModelMessage` union independently -- `splitMultipartToolResults`, `filterUnsupportedMedia`, `normalizeModelImages`, and `sanitizeModelText` -- each re-deriving which roles carry which part shapes, and each able to omit one silently. [model-message-parts.ts](../../../packages/workspace/src/lib/model-message-parts.ts) is the single traversal they are now written against: `mapModelMessageParts` visits every text and media slot with an exhaustiveness check per shape, and `viewToolOutputItem` is the one place that decides which tool-output item shapes hold what. A pass is a visitor over that and nothing more -- `sanitizeModelText` is one line -- so a part shape the SDK adds fails to compile instead of slipping past all four at once.

Media decoding and re-encoding belong to the traversal, not to a pass. A visitor sees bytes and the type they claim, and returns bytes; base64 stays base64, a data URL stays a data URL, and a `Uint8Array` stays one, without any pass knowing which slot it was looking at.

Three omissions were already there, and all three closed with the extraction:

- `filterUnsupportedMedia` matched `image-data` and `file-data` inside tool results, which nothing produces -- `read_file` emits `media` -- so that branch was dead and a model without image input was handed image bytes anyway on every provider that accepts multipart tool results. It was caught only for providers that do not, where `splitMultipartToolResults` had already moved the image into a user message.
- `normalizeModelImages` and `splitMultipartToolResults` matched only `media`, and so would have missed `image-data` and `file-data`, the shapes the SDK is moving to.
- `normalizeModelImages` matched only `file` on a user message, so an image attached as an `image` part -- a separate shape in the same content array -- was never resized, never completeness-checked, and never measured against the decode budget.

None showed up in a test: the capability-filter suite only ever built `user` messages holding `file` parts. That pass also mutated the messages it was given, and one of its tests compared the result to the input it had just mutated, so it passed while asserting the opposite of what happened. The traversal is pure, which turned that assertion into a failure.

A media type is the one thing a part may leave out, and only an `image` part may leave it out. The traversal reports it as `undefined` rather than skipping the part, so the decision stays with each pass: capability is declared per media type and the filter has nothing to match on, while the image pass has bytes and measures them. Skipping it in the traversal would have made this the one shape that opts out of every pass at once, which is the failure mode the traversal exists to remove.

Three text slots are deliberately left alone, each with the reason at the switch arm: a reasoning block, which a provider replays against a signature computed over its exact text; a tool call's input and a `json` output, both of which `JSON.stringify` escapes rather than emitting raw.

Worth noting how thin the type-level protection was: a `tool` message's content is `(ToolApprovalResponse | ToolResultPart)[]`, and only `@instrument-org/shim-client`'s type check caught a pass that assumed otherwise. That was the argument for the shared traversal, from the fix itself.

## 5. Crop mapping is inexact at the edges -- landed

**P2.** `cropRegion` derived one scale factor from width and applied it to both axes. The view's height is a rounded value, so its aspect ratio is not exactly the original's, and the vertical error grows with how far the rounding lands. Separately, origin and extent were rounded independently, so `left + width` could exceed the source by a pixel near the right or bottom edge, which failed the render rather than clamping.

### What to do

Both corners are mapped on their own axis, each clamped to the source bounds, and the extent is derived from the clamped corners.

The out-of-bounds half is the one that actually bites, and it needed an elongated fixture to show: at ordinary aspect ratios the two scale factors agree to within a rounding error, so a test on a merely tall or wide image passes either way. A 4001x37 image gets a view whose short edge rounds to 15, which makes the width-derived factor about 3% wrong vertically -- enough that a region spanning the full view height maps one pixel past the source and fails the render outright. Regression tests cover that shape in both orientations, and they discover the view from a first read rather than hardcoding it, so they also exercise the workflow item 2 documents.

## Sequencing

Items 3, 2, 5, and the tool-output half of 4 landed in that order, then item 1, then item 4's shared traversal. Item 2 turned out not to depend on item 1 after all: "coordinates are in the whole image, not in a crop you got back" is true whichever way the view is computed, so the wording could be corrected without waiting. The traversal went last so that item 1 had stopped moving those passes around.

## Success criteria

- ~~An image whose encoded size is small but whose declared dimensions are enormous is refused without decoding.~~
- ~~A lone surrogate in tool output does not reach the provider, proven for a tool other than `read_file`.~~
- ~~Crops of tall, wide, and edge-touching regions land where they were asked for, within a pixel.~~
- ~~The dimensions named in a `read_file` image result are the dimensions of the bytes in that same result, verified by measuring the returned bytes rather than by comparing two computed values.~~
- ~~Switching models mid-session does not change the coordinate space a previously read image was described in.~~
- ~~A media or text shape the SDK adds is a compile error in one traversal rather than a silent omission in four passes.~~

## What this does not settle

The region read is still unmeasured. These fixes make the contract sound; whether the feature earns its cost is phase 4 of [image-zoom-for-fine-detail.md](image-zoom-for-fine-detail.md), and that eval can now run, since a broken coordinate space would have measured nothing.
