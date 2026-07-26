# Making the image coordinate contract sound

Status: **proposed**. Owner: TBD. Corrections to the work described in [image-zoom-for-fine-detail.md](image-zoom-for-fine-detail.md), from a review of that branch. Everything here is agreed as a real defect; the region read should not be considered trustworthy until items 1 through 3 land.

## The through-line

The region read rests on one promise: **the pixel space we name in text is the pixel space the model is looking at.** Break that and a crop silently returns the wrong part of the picture, which is worse than not having the feature, because a confidently wrong magnified view reads as evidence.

Three separate defects break that promise today, and they share a cause. The annotation and the bytes are produced in different places, at different times, against different inputs. `read_file` computes and persists dimensions at tool-call time; [normalize-model-images.ts](../../../packages/workspace/src/lib/normalize-model-images.ts) re-renders the bytes at send time, every turn, without touching the text that describes them.

## 1. The announced view can disagree with the bytes sent

**P1.** `read_file` computes `viewWidth`/`viewHeight` from the model active during the tool call and persists them. `toModelOutput` renders the text from those persisted values. The bytes are then resized independently on each later turn. Two ways they diverge:

- **A model switch.** The annotation was computed for model A, the bytes are rendered for model B. Whenever their budgets differ the model is told A-sized coordinates while looking at B-sized pixels.
- **The byte-cap shrink**, which needs no model switch at all. `renderImage` walks down an encoding ladder and then shrinks the target by 25% when nothing fits the byte cap, so the image it returns can be smaller than the target it was asked for. The annotation still names the target.

The second is the more likely of the two and was not considered when this was built.

### What to do

Adopt a **fixed harness preview size**, independent of provider and model, and have `read_file` render the bytes it announces.

- `read_file` resizes the image to the preview size itself, within both the pixel budget and the byte cap, and reports the dimensions of what it actually produced. The annotation is then derived from the bytes by construction rather than by agreement.
- `normalizeModelImages` keeps its job for images that do not come from `read_file` (user uploads, generated images), where no annotation exists and free resizing is safe. For a `read_file` image it becomes a no-op, because the image already fits every provider's floor and the byte cap.
- Do not persist model-dependent view coordinates. A coordinate space that changes when the user switches models cannot be referred to by a message written before the switch.

This is also the answer to the reviewer's structural note, and the two arguments are the same argument. `imageView` on provider metadata is speculative: every provider is set to the same floor, the real capability is per-model, and for routed providers (`openrouter`, `vercel`, our own gateway) the provider name says nothing about which model serves the request. Worse, raising it later per-model would **reintroduce this exact bug**, since the coordinate space would again depend on which model was active. A fixed preview is not just simpler today; it is the design that makes the contract stable. Delete the provider-level abstraction and revisit only if per-model image budgets ever become representable, knowing that any per-model preview needs a different answer to coordinate stability.

The cost is that a model with a larger budget no longer sees more of the image on first look. That capability was already given up when every provider was set to the floor, and the region read recovers the detail from the original file, which is the entire point of the feature.

## 2. The documented recursive zoom is wrong

**P1.** The tool description and the agent prompt both tell the model it can narrow further by reading a region "of what you get back". It cannot. Every region is interpreted against the view of the **original** image, so coordinates read off a magnified crop land somewhere unrelated.

This is active misinformation aimed at the model, written into the two places it is most likely to be believed.

### What to do

Fix the wording first, since it is cheap and currently harmful: state plainly that coordinates are always in the original view, and that the response reports the rectangle it used so a subsequent read can subdivide it. The model can still narrow; it just has to express the narrower rectangle in original-view coordinates, and the response gives it the anchor to do so.

Composed provenance (each crop remembering its parent rectangle, transforms multiplied through) is the more capable version and matches how the source cookbook describes the workflow. It is a real feature with real state, not a wording fix. Treat it as a follow-up and only build it if the eval shows the model struggling to subdivide in original coordinates.

## 3. Byte size does not bound decoded pixels

**P1.** The branch removed the 8000px dimension guard and raised the byte ceiling to 50 MB, with a comment claiming the byte cap guards against decoding something pathological into memory. That comment is wrong, and being wrong in a comment is worse than being absent, because it tells the next reader the hazard is handled.

Compression ratio is unbounded for synthetic images. A small PNG of a solid colour can declare dimensions large enough to allocate gigabytes when decoded, before any scaling happens.

### What to do

Keep a **decoded pixel-count limit**, checked before anything decodes. `measureImage` already reads dimensions from the header, so the declared size is known for free and no decode is needed to reject. A limit in the low hundreds of millions of pixels admits ordinary large scans (a 12000x12000 scan is 144M) while refusing anything that would allocate absurdly. Replace the misleading comment with what the byte cap actually does.

## 4. Text sanitation skips tool output

**P1.** [sanitize-model-text.ts](../../../packages/workspace/src/lib/sanitize-model-text.ts) returns every `tool` message unchanged, while its own doc comment claims it strips unpaired surrogates from every outgoing text part. Tool results are where file contents and command output reach the model, so the pass misses the largest source of the problem it exists to solve. The `read_file` truncation fix protects one producer; every other tool is unprotected.

### What to do

Sanitize tool result output in both its shapes: `{ type: "text", value }` and the text entries inside `{ type: "content", value: [...] }`.

Then address the reason the gap was easy to create. Four passes now walk the `ModelMessage` union independently: `splitMultipartToolResults`, `filterUnsupportedMedia`, `normalizeModelImages`, and `sanitizeModelText`. Each re-derives which roles carry which part shapes, and each can silently omit one, which is exactly what happened here. Extract a single canonical traversal that visits every text part and every media part regardless of role, and express the passes as transforms over it. That makes an omission a compile error rather than a quiet hole, and it is a precondition for adding more passes cleanly.

## 5. Crop mapping is inexact at the edges

**P2.** `cropRegion` derives one scale factor from width and applies it to both axes. The view's height is a rounded value, so its aspect ratio is not exactly the original's, and the vertical error grows with how far the rounding lands. Separately, origin and extent are rounded independently, so `left + width` can exceed the source by a pixel near the right or bottom edge, which fails the render rather than clamping.

### What to do

Map both corners independently with separate x and y scales, clamp each to the source bounds, then derive width and height from the clamped corners. Add cases for a tall image, a wide image, and a region touching each edge.

## Sequencing

1. **Item 3** first. It is self-contained, it is a resource-exhaustion hazard rather than a correctness wrinkle, and it does not depend on the others.
2. **Item 1**, which is the largest change and deletes the provider metadata added for it.
3. **Item 2**, whose correct wording depends on what item 1 settles about the coordinate space.
4. **Item 5**, small and independent.
5. **Item 4**, splitting it: the tool-output fix immediately, the shared traversal as a refactor once the passes above have stopped moving.

## Success criteria

- The dimensions named in a `read_file` image result are the dimensions of the bytes in that same result, verified by measuring the returned bytes rather than by comparing two computed values.
- Switching models mid-session does not change the coordinate space a previously read image was described in.
- An image whose encoded size is small but whose declared dimensions are enormous is refused without decoding.
- A lone surrogate in tool output does not reach the provider, proven for a tool other than `read_file`.
- Crops of tall, wide, and edge-touching regions land where they were asked for, within a pixel.

## What this does not settle

The region read is still unmeasured. These fixes make the contract sound; whether the feature earns its cost is phase 4 of [image-zoom-for-fine-detail.md](image-zoom-for-fine-detail.md), and it should run after these land rather than before, since an eval against a broken coordinate space measures nothing.
