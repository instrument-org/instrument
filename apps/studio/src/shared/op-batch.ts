/**
 * The envelope of a store main owns and windows change by ops (the drafts,
 * the bookmarks): each window numbers the batches it sends, and main's
 * snapshot says, by window, the last one it applied.
 */

/** A batch of ops from one window, numbered so main can say which it has applied. */
export interface OpBatch<Op> {
  /** The window sending, by the id it made for itself as it loaded. */
  client: string;
  ops: Op[];
  /** Counts up per window; the batch is applied once an ack reaches it. */
  seq: number;
}

/** Main's snapshot as a window receives it: whatever it holds, and by window the `seq` of the last batch it applied. */
export interface AckedSnapshot {
  acks: Record<string, number>;
}

/**
 * Whether a window sent a batch at all. The ops in it are the renderer's own,
 * built by the same module main applies them with, so only the envelope is
 * checked here.
 */
export function isOpBatch<Op>(value: unknown): value is OpBatch<Op> {
  return (
    typeof value === "object" &&
    value !== null &&
    "client" in value &&
    typeof value.client === "string" &&
    "seq" in value &&
    typeof value.seq === "number" &&
    "ops" in value &&
    Array.isArray(value.ops)
  );
}

/** Records a batch as applied in main's acks, which never go back. */
export function ackBatch(acks: AckedSnapshot["acks"], batch: OpBatch<unknown>) {
  acks[batch.client] = Math.max(acks[batch.client] ?? 0, batch.seq);
}
