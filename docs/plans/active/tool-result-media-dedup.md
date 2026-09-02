# Plan: store tool-result media once, by content hash

Status: proposal, not started. Grew out of the media-bloat finding in [code-review-2026-08-29.md](../../findings/code-review-2026-08-29.md). Shares a boundary with [conversation-storage.md](conversation-storage.md), which decides where conversation data lives at all; this plan decides what a media-carrying tool result stores, and holds whichever store that plan lands on.

## Problem

`read_file` puts the rendered bytes of an image, PDF, audio, or video into the tool part it persists, base64-encoded, on every call. Nothing dedupes, so reading the same unchanged file five times writes five copies into the task's database.

Measured on a real product-images task: a 42.6MB `task.db` in which 40 `tool-read_file` parts hold 40.2MB, with eight files read four to six times each. The seven largest databases in a recent 110-task window are all this genre. In that task every stored payload is a whole-image preview and the repeats of unchanged sources are byte-identical, so hashing the rendered bytes would collapse roughly 40.2MB to roughly 12MB.

The cost is not only disk. Parts are superjson-encoded values in a key-value store, so the bytes are re-parsed whenever the messages they belong to are read: on every model request that builds from the store, on task open, and on export. A task that views a handful of images pays that repeatedly, and grows for the life of the task.

## Where the bytes come from and go

Four of the `read_file` output variants carry `base64Data`: `image`, `pdf`, `audio`, and `video` ([read-file.ts](../../../packages/workspace/src/tools/read-file.ts)). It is produced in four places: the whole-file read for non-image media, the two preview paths, and the cropped-region render.

It has exactly two readers:

- `toModelOutput` in the same file, which passes it to the model as the tool result's media.
- [tool-read-file.tsx](../../../apps/studio/src/client/components/message-part/tool-read-file.tsx), which builds a `data:` URL for the transcript in four places.

Both want bytes at the moment they run. Neither wants them stored inline, which is what makes this tractable: the part can hold a reference and the two readers can resolve it.

## Shape

Hash the **rendered** bytes, not the source file. The same path legitimately produces different renders within one task, because a region, a preview size, or a provider budget changes what is rendered, and the transcript must keep showing what the model was actually given. Hashing the render is what makes a repeat a repeat and a genuinely new render a new entry.

The part stores the hash, the mime type, and the dimensions it already carries. The bytes live once per task, keyed by hash.

Resolution happens at the two readers: model-message conversion inlines the bytes when building the request, and the renderer fetches them for display. This preserves the rule that conversion is deterministic from what is stored: it re-reads bytes by hash, never re-renders, so a transcript cannot start claiming the model saw something it did not.

## Open decisions

**Where the bytes live.** The task database is a key-value store accessed by prefix scans (`messages:`, `parts:`, `sessions:`), so a `blobs:<hash>` prefix would never be touched by a message read, which is most of the win and keeps export working unchanged, since the export carries one database file. The alternative is files under the task's private directory, which streams better and is easier to serve, at the cost of teaching export and import about a second location. Decide with `conversation-storage.md`, since a conversation-scoped store would answer both.

**How the renderer gets bytes.** Today they arrive inline on the part over IPC. With a reference it needs either a small RPC that resolves a hash, or a route on the per-task asset origin. The asset origin's path space is the virtual filesystem's, and the private directory is masked there, so a blob route would be a deliberate addition rather than a free one.

**Reading old parts.** Existing tasks hold inline bytes on disk. The read path has to keep understanding them: this is stored user data, not unreleased code, and a task that fails to open costs the person whose task it was. Write references, read both, and treat a rewriting migration as a separate decision rather than a prerequisite.

**Collecting garbage.** Blobs are per-task, so deleting a task takes them. Within a task, a blob is unreferenced only if the part naming it was deleted. Doing nothing at first is defensible and still collapses the duplicates that cause the growth; a sweep can come later if branching turns out to strand much.

## Worth doing at the same time

The finding this came from sits next to two others in the same file that share its shape: unbounded, invisible per-task disk growth, and the legacy per-task browser profiles that nothing reads. A user seeing sizes in the Storage settings tab would also see the effect of this change, which makes the two worth sequencing together.
