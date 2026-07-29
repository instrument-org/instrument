# Zooming into images to read fine detail

Status: **active (all four phases landed in this repo)**. Owner: TBD. The plumbing, the region read, the prompt guidance, and the eval that measures them are in. Two things are deliberately outstanding: phase 3's `agent-browser` cross-reference, which belongs in the skills repo because the registry is read-only here, and the decision in phase 4 about whether a zoom-happy model's context cost needs a cap.

## Source

Anthropic cookbook, [multimodal/crop_tool.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/multimodal/crop_tool.ipynb). It gives the model a `zoom(x1, y1, x2, y2)` tool: the model names a rectangle in pixel coordinates, the host crops that rectangle out of the **full-resolution original** and returns it **magnified to fill the image token budget**. Reported on Chartography (100 chart-reading questions): 29% -> 73% for `claude-fable-5`, 13% -> 44% for `claude-sonnet-5`, at roughly 10-30x the per-question cost.

Three design points from the notebook that are the real content:

1. An image costs one visual token per 28x28 patch, and each model has a budget (1568px/1568 tokens standard tier, 2576px/4784 tokens high tier). Anything over the budget is **silently downscaled server-side**, and small detail scales away with it.
2. Because of that downscale, the pixel coordinates a model emits refer to the image **it saw**, not the file on disk. The notebook's fix is `prepare_image()`: pre-resize client-side to exactly the size the model will be shown, so coordinates map 1:1.
3. Crop from the original, then scale the crop **up** to fill the budget, so each element covers as many patches as possible. Return JPEG, not PNG, because every crop stays in the transcript and full-budget PNGs blow the 32MB request limit.

Its own closing note is the one that matters for us:

> if you run Claude in an agent framework with code execution, you may not need to build any of this: an agent that can run code will typically write its own crop-and-magnify script on demand.

Instrument is that framework. We already have the pixels, the crop, and the magnify. The tool is not the missing piece.

## What is actually missing

### 1. The agent has no idea what pixel space it is looking at

[read-file.ts](../../../packages/workspace/src/tools/read-file.ts) sends the raw file bytes base64-encoded, with one line of text: `` `${config.label} file: ${output.filePath}.` `` ([read-file.ts:453](../../../packages/workspace/src/tools/read-file.ts#L453)). No dimensions. No note that the provider downscaled it. `imageSize` is already imported and called, but only to enforce a guard ([read-file.ts:108-118](../../../packages/workspace/src/tools/read-file.ts#L108-L118)); the numbers are thrown away.

So when the agent reads a 3840x2160 screenshot, it is shown roughly 2576x1449 (Anthropic high tier) or 1568x882 (standard tier) and is told neither number. Any coordinate it reasons about is in a space it cannot name, and any crop we let it request would land in the wrong place by the scale factor. This is a correctness bug waiting to happen, and it is also the cheapest thing on this list to fix.

The agent can get dimensions today with `ffprobe` -- the bash description even recommends it for image inspection ([create-bash-env.ts:336](../../../packages/workspace/src/lib/create-bash-env.ts#L336)) -- but only if it thinks to, and it is not in the path of an ordinary `read_file`.

### 2. The agent does not know it cannot see

This is the load-bearing gap. The cookbook's numbers come from a tool sitting in the tool list for one question that is known to be detail-bound. Our agent reads an image mid-task and forms a confident wrong impression; it does not experience "I cannot read this". Nothing prompts it to look closer, so a capability it already has (below) goes unused.

Corollary: a skill-only solution does not work. `load_skill` requires the agent to already suspect the problem, which is exactly what it does not do.

### 3. Oversized images hard-fail instead of degrading

`read_file` errors out above 5MB ([read-file.ts:47-52](../../../packages/workspace/src/tools/read-file.ts#L47-L52)) or 8000px on a side ([read-file.ts:63](../../../packages/workspace/src/tools/read-file.ts#L63)), telling the agent to resize first. For a user who attached a 12000px scan that is a detour at best. A pre-resize step makes both guards mostly moot.

## What we already have

Nothing here needs a new dependency.

- **ffmpeg** is a direct dependency of `packages/workspace` (`ffmpeg-static`, resolved in [lib/ffmpeg.ts](../../../packages/workspace/src/lib/ffmpeg.ts)) and already exposed to the agent as a bash command ([shell-commands/ffmpeg.ts](../../../packages/workspace/src/lib/shell-commands/ffmpeg.ts)). `crop=w:h:x:y,scale=W:H:flags=lanczos` is the whole operation.
- **image-size** is a direct dependency, already used in `read_file`.
- **sharp-images** skill in the registry ships `crop.ts` (sharp `extract`), `resize.ts`, and `annotate.ts`. Registry is a read-only submodule; edits go in the sibling skills repo.
- Tool `execute` receives the resolved `model` ([tools/types.ts:34-46](../../../packages/workspace/src/tools/types.ts#L34-L46)), so per-provider limits are available at read time.
- `toModelOutput` supports multipart content (text + media), and [split-multipart-tool-results.ts](../../../packages/workspace/src/lib/split-multipart-tool-results.ts) already re-shapes it for providers that cannot take media in a tool result.

The one thing bash cannot do: `bash`'s `toModelOutput` returns text only ([bash.ts:184-187](../../../packages/workspace/src/tools/bash.ts#L184-L187)). A crop produced in bash has to come back through `read_file`. That is two tool calls and a temp file per zoom, and it is the deciding constraint on shape.

## Prior art

Two harnesses worth comparing against. Neither has anything like a zoom, so the crop half of this plan is new ground. Both, however, **pre-resize before send**, which we do not, and both do it at a **central choke point rather than in the read tool** -- a better structure than the one this plan originally proposed.

### opencode

Its read tool (which ours was adapted from) does nothing image-specific: sniff the mime, return the raw bytes as a data-URL attachment, output text `"Image read successfully"`. No dimensions, no size guard, no resize.

The work happens in a separate `Image.normalize` service (`src/image/image.ts`), applied at two choke points: user attachments in `session/prompt.ts` and **tool outputs** in `session/processor.ts`. So it catches every image regardless of which tool produced it.

- Bounds: 2000x2000 and 5MB base64, all four values user-configurable (`attachment.image.auto_resize`, `max_width`, `max_height`, `max_base64_bytes`).
- Resizer is photon (Rust/WASM, `@silvia-odwyer/photon-node`), Lanczos3, with the wasm vendored and the loader patched so Bun-compiled binaries find it.
- Notable: a **quality/size ladder** rather than a single guess. Scale to fit the box, then try PNG, then JPEG at qualities `[80, 85, 70, 55, 40]`, take the first candidate under the byte cap; if none fits, shrink 25% and repeat, up to 32 steps.
- Failure degrades rather than errors: the image is dropped with `[N images omitted: could not be resized below the image size limit.]` appended to the output.

### codex

No file-read tool at all (shell plus `apply_patch`). Images enter through a dedicated **`view_image` tool** -- the option this plan lists as rejected, so worth weighing that they chose it. Its whole description is one sentence: "View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk."

- Gated on `InputModality::Image`, with an explicit respond-to-model error when the model cannot take images.
- A **`detail` parameter, `high` (default) or `original`**, where `original` preserves exact resolution. It is only present in the schema when `model_info.supports_image_detail_original`, so the model-facing surface changes per model. An unknown value is rejected with a message naming the valid ones rather than being silently coerced.
- The tool itself does not resize. Comment in `view_image.rs`: "The history insertion path owns image decoding and resizing." `core/src/image_preparation.rs` walks every outgoing response item -- messages **and** function-call outputs -- and resizes there.
- The bounds are **patch-budget based, the same math as the cookbook**: `PromptImageResizeLimits { max_dimension, max_patches }` with `PROMPT_IMAGE_PATCH_SIZE = 32` (OpenAI's patch size; Anthropic's is 28). High detail is 2048px / 2500 patches; original is 6000px / 10000 patches. It scales to `max_dimension` first, then, if still over the patch budget, by `sqrt(patch^2 * max_patches / (w * h))`, flooring the patch grid so integer output dimensions stay inside the budget.
- Preserves ICC and EXIF across the re-encode, and only copies the ICC profile when its color-space signature (ICC bytes 16..20) is `RGB `, since JPEG decode can convert CMYK to RGB and make the source profile a lie. Filter is Triangle, not Lanczos.
- SHA1-keyed LRU cache (32 entries / 64MB) keyed on (digest, mode), so re-sending an image across turns does not re-decode it.
- Failure degrades: the image content item becomes a text placeholder, e.g. "image content omitted because it exceeded the supported size limit; use a smaller image".

### What we take from it

1. **Move the resize to the message-prep choke point.** [prepare-model-messages.ts:157-162](../../../packages/workspace/src/lib/prepare-model-messages.ts#L157-L162) already runs `splitMultipartToolResults` and `filterUnsupportedMedia` over outgoing messages; that is our equivalent of codex's `prepare_response_items` and opencode's `normalize`. Doing it there covers `generate_image` output and user uploads, not just `read_file`. Phase 1 changes accordingly.
2. **Degrade, do not error.** Both replace an unusable image with a text placeholder. Our hard errors at 5MB / 8000px are the outlier.
3. **The patch-budget math is settled prior art**, and codex's 32 vs Anthropic's 28 is direct evidence that the constant belongs in per-provider metadata rather than a shared constant.
4. **Cache by content digest.** Cheap, and it directly addresses the repeated-encode half of the cost concern below.
5. **`detail: original` is a cheaper middle option than a region read** (see the shape table).
6. **Neither reports dimensions to the model.** That is not evidence it does not matter -- neither has a crop feature that would need it -- but it does mean gap 1 is unsolved everywhere, not just here.

## Goal

The agent reliably notices when an image is too small to read, and can get a magnified, correctly-positioned view of any region in one step.

### Success criteria

- Every image `read_file` returns states its file dimensions and, when the model is seeing a downscaled copy, the dimensions of that copy.
- A region read of a known rectangle returns that rectangle after ordering and clamping -- the one echoed back in the result -- magnified, verified against a generated fixture with known ground truth.
- An eval case built like the cookbook's demo (dense chart, tiny annotation, ground truth known because we drew it) passes with the feature and fails without it.
- A 12000px image reads successfully instead of erroring.
- No behavior change and no added tokens for tasks that read no images.

## Shape

Recommendation: **a `region` parameter on `read_file`**, not a new tool and not a bash command.

Rejected alternatives, with reasons:

| Shape                                                                   | Why not                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `zoom_image` tool                                                   | Adds a tool to a fixed 9-tool set. Every task pays the prompt tokens; almost none have images.                                                                                                                                                                                                                                                |
| New `zoom` bash command                                                 | Still needs gap 1 solved to be correct, and the crop must come back through `read_file` anyway. Two calls, a temp file, and a `readOnly: false` write for what is conceptually a read. Six tool calls for a three-zoom sequence.                                                                                                              |
| Skill-only recipe                                                       | Requires the agent to already suspect it cannot see. That is gap 2, unaddressed.                                                                                                                                                                                                                                                              |
| Prompt-only instruction                                                 | Static prompt text is read once at session start, far from the moment an image arrives.                                                                                                                                                                                                                                                       |
| codex's `detail: original` (re-read the whole image at a higher budget) | Cheapest to build and a real improvement, but it only helps when the image is near the budget. A 6000px screenshot is still illegible at 6000px-worth of patches, and it spends the larger budget on the whole frame rather than the part that matters. Worth shipping as a fallback for the case where the agent cannot localize the detail. |

The `region` parameter wins on discovery: it sits in the schema of the tool the agent is already invoking on the image, and gap 1's text can carry a pointer to it at exactly the moment the image is downscaled. It is one round trip, no disk write, so `read_file` stays `readOnly: true`.

Following codex, expose `region` in the schema only when the model accepts image input (`inputImage`), so tasks on a text-only model do not see a parameter that cannot work.

The bash route stays available and unblocked for the things a fixed parameter cannot express: batch inspection, contact sheets, annotate-then-read, diffing. Those are skill territory, not harness territory.

### Why none of this is a skill

The harness gains no new tool and no new bash command. What it gains is one optional parameter on a tool that already reads images, plus plumbing with no model-facing surface at all.

A skill was the tempting answer, and it fails on the same point twice. `load_skill` is a deliberate act: the agent has to suspect it needs help before it goes looking. The failure this addresses is the agent _not_ suspecting -- it looks at a chart, reads a number wrong, and moves on with no sense that anything was lost. Nothing prompts the skill load. And the coordinate space problem has to be solved in the harness regardless, because only the harness knows which provider is being called and what it does to an oversized image; a skill given the wrong pixel space just crops the wrong rectangle confidently.

Where a skill does earn its place is everything past one rectangle: contact sheets, annotate-then-read, batch inspection, before-and-after diffs. Those are composed workflows, they are already possible with `sharp-images` and ffmpeg, and they are the right thing to reach for once the agent knows it needs to look closer. This plan is about it knowing.

## Plan

### Phase 1: coordinate ground truth -- landed

1. [image-view-size.ts](../../../packages/workspace/src/lib/image-view-size.ts) holds the budget math: the largest aspect-preserving size inside a max-edge and max-patch cap. Implemented as the cookbook's binary search rather than codex's closed form, because the closed form lands a patch either side of the boundary and "off by a patch" means the provider resizes again behind us.
2. `imageView: { maxEdge, maxPatches, patchSize }` on [provider-metadata.ts](../../../packages/ai-gateway/src/schemas/provider-metadata.ts), as a top-level field rather than under `quirks` -- it is a limit, not a deviation.
3. **Every provider sits at the 1568 / 1568 / 28 floor**, which is a change from the original plan. Raising Anthropic to its high tier (2576 / 4784) would be right for a high-tier model and wrong for a standard-tier one, and we only have provider granularity: a model catalogue entry carries `inputImage` as a boolean and nothing about size. Guessing high means sending an image the provider downscales again, which puts us back to describing a view that never existed. The cost is real -- a 2000px screenshot that a high-tier model would have rendered whole now arrives at 1456px -- but it is bounded, and the region read recovers the detail from the original file. **Raising a provider's numbers needs per-model image budgets first.**
4. [normalize-model-images.ts](../../../packages/workspace/src/lib/normalize-model-images.ts) runs in [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) after `filterUnsupportedMedia` and before `addCacheControlToMessages`. Covers user uploads, `read_file`, and `generate_image` in one place.
5. [render-image.ts](../../../packages/workspace/src/lib/render-image.ts) does the ffmpeg work, piped in and out with no disk write. PNG first, then JPEG at descending quality (full chroma for the top two steps, since 4:2:0 smears hairline chart rules), then a 25% shrink and around again. An image that fits nothing becomes a text placeholder rather than a failed turn.
6. Renders are cached by content digest, which matters more here than it looks: `prepareModelMessages` rebuilds the whole transcript every turn, so without it every image in the history is re-encoded on every request. Byte-identical output on a cache hit is also what keeps the prompt cache from breaking.
7. `measureImage` reads EXIF orientation and reports **displayed** dimensions, so a phone photo stored a quarter turn from how it is shown is described the way the model sees it. ffmpeg applies the same rotation on decode, so a crop's coordinates mean the same thing on both sides.
8. `read_file` carries `width`/`height`/`viewWidth`/`viewHeight` and says, e.g., `Image file: work/shot.png (3840x2160 px, shown to you at 1456x819)`. The 8000px refusal is gone and the byte ceiling is 50 MB, since an oversized image is now resized rather than turned away.

### Phase 2: the region read -- landed

9. `region: { x1, y1, x2, y2 }` on `read_file`, in the pixel space of the image as the model was shown it.
10. The parameter is **always in the schema**, not gated on `inputImage` as planned: `inputSchema` receives only the agent name, and threading the model through `setupTool` to hide one optional parameter is not worth the churn. A region read on a text-only model degrades exactly like an ordinary image read, through `filterUnsupportedMedia`.
11. Corners are ordered and clamped, and the rectangle actually used comes back in the result, so a coordinate-space mistake shows up instead of silently returning the wrong part of the picture. An empty or fully out-of-bounds region answers the model rather than failing the turn.
12. The crop comes from the full-resolution file and is scaled up to fill the budget. **Output is PNG-first, not JPEG as the cookbook does.** Its reason was the API's 32 MB whole-request limit; our constraint is the 5 MB per-image cap, which a full-budget PNG usually clears, and text is what this feature exists to read. JPEG remains the fallback through the same ladder.
13. [tool-read-file.tsx](../../../apps/studio/src/client/components/message-part/tool-read-file.tsx) labels a region read with the rectangle so it reads as a zoom in the transcript.

### Phase 3: teach the instinct -- landed

14. A downscaled image read carries the trigger inline: it says small text may not have survived and points at `region`. This fires exactly when detail was lost and nowhere else.
15. One bullet in the main agent prompt next to the existing verification guidance ([main.ts](../../../packages/workspace/src/agents/main.ts)): seeing an image is not reading it, and a confident first impression of a small detail is often wrong.
16. **Not done:** the `agent-browser` skill cross-reference, where screenshots are the dominant dense image. Registry is read-only, so that edit belongs in the skills repo.

### Phase 4: measure -- landed

17. Three cases in [image-region.ts](../../../packages/workspace/evals/cases/image-region.ts). Two draw the answer at a size the fixed preview renders around three pixels tall, so a correct answer is very hard to produce without going back to the file; the third is legible whole and asserts **no** zoom, which is what stops this measuring enthusiasm instead of judgement. Every prompt names what to find and never how.
18. **The affordance works, and it is found unprompted.** Across `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`, and `x-ai/grok-4.5`, every model reached for `region` on both zoom cases and read the exact value. The only failure in eighteen assertions is the negative case, and only for gpt-5.6.
19. **Restraint is where models differ, not capability.** Sonnet and Grok answered the legible image from the first look. The gpt-5.6 family zooms before it has seen anything: on every image read it opened with an all-zero rectangle, and on the legible case it went on to request a whole-image region it did not need. The all-zero call is handled in `read_file` now; the speculative whole-image read is model behavior, and adding "omit this on a first read" to the parameter description was tried and measured to produce _more_ of it.
20. **The bounds error is load-bearing.** A model that guessed the wrong coordinate space recovered from the sentence naming the right one. That error text is a feature, which is also why an all-zero rectangle is answered rather than refused: it names no space to correct.

Corrupt attachments are measured separately, in [unreadable-media.ts](../../../packages/workspace/evals/cases/unreadable-media.ts). The prevention work only pays off if the agent acts on the tool error rather than inventing an answer or re-reading the file forever, and neither is visible to a unit test. That eval earned its place immediately: it found a tool message that sent a model into a 4.1M-token repair loop, recorded in [tool errors that invite repair loops](../../findings/tool-errors-that-invite-repair-loops.md), and a truncated image inside the preview budget reaching the provider untouched, because the byte-for-byte passthrough is the one path that decodes nothing.

Three defects in the region read came out of the same runs, all of them the model filling in a parameter rather than aiming at anything: an all-zero rectangle on every image read, a 1x1 rectangle magnified into a flat colour the model reported as a blank screen, and a whole-image region requested before it had seen the image. The first two are handled in the tool now. **The general lesson is that a magnified crop is believed**, so any rectangle that cannot carry a picture has to be refused rather than rendered.

## Risks and open questions

- **Context cost.** Each crop is a full-budget image that lives in the transcript forever. The cookbook measured 10-30x per-question cost. In a long general-purpose session, three zooms across a task is fine; a model that zooms reflexively is not. The digest cache in phase 1 removes the repeated-encode cost but not the context growth. Remaining options: cap crops per turn, cap magnification below the full budget, or evict older crop images on replay. Neither reference harness solves this -- both hold every image in history. **Still undecided, but phase 4 narrowed it**: on a single-question task the spread was two to three region reads per case, and the model that zoomed most was the one that zoomed before looking rather than one that kept subdividing. That argues the cost is bounded by how a model opens an image read, not by runaway refinement, so a cap on crops per turn would bite the wrong behavior. Revisit with a multi-turn case, which is what a real session looks like and what none of these cases are.
- **Fill the budget or not.** The cookbook fills it deliberately (more patches per element reads better even when interpolated) and its numbers back that. But upscaling a 40x30 region to 1568px wide spends the full budget on 1200 real pixels. Worth testing a magnification cap as a variant; do not assume it is free.
- **Provider drift.** The view-size math is per-provider and will go stale. The conservative default limits the blast radius: a bound smaller than the provider's real one costs some resolution but never breaks coordinates.
- **Non-vision models.** [filter-unsupported-media.ts](../../../packages/workspace/src/lib/filter-unsupported-media.ts) already substitutes text for media a model cannot take, so a region read degrades the same way an image read does. It still spends an ffmpeg render on a crop nobody sees; cheap enough to leave.
- **The floor costs high-tier models resolution.** See phase 1 step 3. This is the one place the implementation trades something real away, and it is reversible the moment per-model image budgets exist.
- **Pre-resize changes what the agent is shown, not the file on disk.** It is the same downscale the provider would have done, so it is a wash, and the crop still reads from the original. Stated in the code so nobody "fixes" it later.
- **The accuracy numbers here are still the cookbook's**, on its benchmark, with its tool. Phase 4 settles that the affordance is found and used correctly across models, which was the risk that mattered; it does not produce a with-and-without accuracy delta of our own. What stays unmeasured is context growth over a long session and the cost of a zoom-happy model across many turns.

## Defects found in review

[image-read-coordinate-contract.md](../completed/image-read-coordinate-contract.md) records five confirmed defects, three of them breaking the promise this feature rests on: that the pixel space named in text is the pixel space the model sees. All five landed before the phase 4 eval ran, which was the order that mattered -- measuring against a broken coordinate space would have measured nothing.

## Follow-on plans

The image work put a validation pass at the send boundary, which turned out to be the right place for a problem larger than images:

- [session-recovery-from-unsendable-content.md](session-recovery-from-unsendable-content.md) -- a rejected part is permanent, because parts are persisted before they are validated and the whole transcript is replayed every turn. The image validation here is the prevention half; classification and recovery are not built.
- [context-compaction.md](context-compaction.md) -- the same permanent-failure shape from a different cause, and the escalation path recovery needs.

## Out of scope

- **PDF regions.** `read_file` sends PDFs as media too, and dense scans have the identical problem, but a region read there needs a page index and rasterization. Same shape, separate plan.
- **Video frames.** ffmpeg frame extraction is the analogous move. Separate plan.
- **Annotation-assisted zoom** (draw the grid, let the model point at a cell). Interesting, unmeasured, and it competes with plain coordinates rather than complementing them.
