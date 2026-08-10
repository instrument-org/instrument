# Plan: incremental live transcript updates

Status: proposed, not started. Follow-up to the live message subscription rework (`workspace: re-read only changed messages in live message subscription`), which cut per-update store work to O(changed) but left the wire and client-render costs at O(session). Pairs with `chat-stream-turn-model-refactor.md`, which is the rendering half of this.

---

## Background / why

The live transcript is `message.live.listWithParts` ([message.ts](../../../packages/workspace/src/rpc/routes/message.ts)) → `experimental_liveOptions` on the client ([chat.tsx](../../../apps/studio/src/client/components/task/chat.tsx)). After the rework, each streaming event now re-reads only the changed messages on the server. Two costs per yield are still proportional to the whole session, not the change:

1. **Wire serialization.** Every yield serializes the entire `SessionMessage.WithParts[]` across the MessagePort, even when one message changed.
2. **Client re-render.** `experimental_liveQuery` does a plain `setQueryData(queryKey, chunk)` (full replace), so `messagesQuery.data` is a brand-new array each yield. `chat-stream.tsx` then rebuilds its entire `chatElements` in one `useMemo` over that array.

During a streaming turn these fire on every coalesced batch, so on a long transcript the per-token cost is still dominated by session size.

## Key insight

The server snapshot (`LiveMessagesSnapshot`) already preserves **per-message referential identity**: `upsert` replaces only changed message objects, so unchanged messages keep their original object across yields. That identity is destroyed at the transport boundary: serialize + deserialize produces a fully fresh array of fresh objects every yield, so the client cannot tell which messages actually changed. Restoring that signal on the client is what unlocks the render win, and sending only the delta is what unlocks the wire win.

## Proposed approach (two coordinated levers)

**A. Client-side reconcile-by-id (restore referential stability).** Wrap the live query so each yielded array is merged into the cached array, reusing the existing object for any message whose id + contents are unchanged (id match plus a cheap equality check, or a per-message version/`updatedAt` if we add one). Unchanged turns then keep referential identity across yields. Cuts render cost; does not cut wire.

**B. Patch protocol (cut the wire too).** Change the event payload from "full array" to "changed + removed message ids (with bodies for changed)". The client applies the patch to its cached array. This is the larger change: `experimental_liveQuery` assumes each chunk _is_ the value, so it needs a custom merging query function (or a small `experimental_liveQuery` replacement) instead of plain `setQueryData`.

**C. Per-turn memoized render (the turn-model refactor).** Levers A/B only pay off if the renderer skips unchanged turns. Today's single `chatElements` loop rebuilds everything from a new array reference regardless. The `chat-stream-turn-model-refactor` (stable per-turn rows keyed by message id) is the prerequisite that turns "unchanged message ref" into "skipped re-render".

## Contract options / tradeoffs

- **A + C (recommended first step).** Keeps the current full-array server contract and the eager-subscribe handler untouched; adds a client reconcile layer and the per-turn memo. Lower risk, cuts the client-render cost (usually the more visible one), and is a clean prerequisite for B.
- **B + C (second step, if wire is the bottleneck).** Add the patch protocol once A+C is in and measurement shows serialization of large sessions / big tool-output parts is the remaining cost. More invasive: new payload schema, custom client merge, ordering/gap handling on the client.

## Migration path (incremental)

1. Land `chat-stream-turn-model-refactor` (C) so turns are stable memoized rows.
2. Add a reconcile-by-id wrapper around the live messages query (A). Verify against the debug transcript route and its scenarios that unchanged turns stop re-rendering during a stream (React Profiler / render-count assertion).
3. Measure wire cost on a large session. If it dominates, add the patch protocol (B): a delta event schema, a custom merging query function, and client-side apply with the same id-ordering the snapshot uses.

## Dependencies

- `chat-stream-turn-model-refactor.md` (rendering half; prerequisite for any render win).
- The server snapshot's referential-stability property (already in place); keep it when touching `LiveMessagesSnapshot`.

## Risks / open questions

- **Equality check cost (A).** Reconcile-by-id needs a cheap "did this message change?" test. Deep-equals on a large message with many parts could rival the render it saves. A per-message version bumped on write (or reusing message `updatedAt`) avoids deep comparison; worth deciding before building A.
- **Ordering and gaps (B).** A patch stream must preserve the snapshot's id ordering and tolerate a client that missed the initial snapshot (reconnect): the client needs a resync path (fall back to a full read) when it can't apply a patch cleanly.
- **Streaming smoothness.** Reconcile/patch must not visibly regress token-by- token streaming of the active turn (the one turn that legitimately re-renders every batch).

## Non-goals

- Not initial-load pagination (last N turns + load-older); that is a separate, independent plan and unblocks first paint on huge sessions rather than per-update cost.
- Not a change to the server's per-message re-read strategy, which already lands the store-side win.
