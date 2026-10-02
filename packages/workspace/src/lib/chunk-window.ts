import { utf8Suffix } from "./utf8-byte-slice";

/**
 * The most recent text under a byte ceiling, dropping from the front and
 * counting what it dropped.
 *
 * The eviction is the fiddly part, and the reason this is one place rather than
 * two: a chunk that only partly overflows is trimmed from its left at a code
 * point boundary instead of being dropped whole, so the ceiling holds without
 * discarding more than it must and without splitting a character. The pending
 * output buffer and the tail of `BoundedText` both want exactly that, and each
 * had its own copy of it.
 */
export class ChunkWindow {
  /** Bytes currently retained. */
  get bytes(): number {
    return this.retainedBytes;
  }

  /** Bytes dropped from the front since the last `take`. */
  get omittedBytes(): number {
    return this.dropped;
  }

  private readonly capBytes: number;
  private chunks: string[] = [];
  private dropped = 0;
  private retainedBytes = 0;

  constructor(capBytes: number) {
    this.capBytes = capBytes;
  }

  /** Retained text, left in place. */
  peek(): string {
    return this.chunks.join("");
  }

  /** Retained text and what was dropped, clearing both. */
  take(): { omittedBytes: number; text: string } {
    const text = this.peek();
    const { dropped } = this;
    this.chunks = [];
    this.dropped = 0;
    this.retainedBytes = 0;
    return { omittedBytes: dropped, text };
  }

  write(text: string): void {
    if (!text) {
      return;
    }
    this.chunks.push(text);
    this.retainedBytes += Buffer.byteLength(text, "utf8");

    while (this.retainedBytes > this.capBytes) {
      const first = this.chunks[0];
      if (first === undefined) {
        break;
      }
      const firstBytes = Buffer.byteLength(first, "utf8");
      const overflow = this.retainedBytes - this.capBytes;
      if (firstBytes <= overflow) {
        this.chunks.shift();
        this.retainedBytes -= firstBytes;
        this.dropped += firstBytes;
        continue;
      }

      const kept = utf8Suffix(first, firstBytes - overflow);
      const keptBytes = Buffer.byteLength(kept, "utf8");
      const droppedBytes = firstBytes - keptBytes;
      this.chunks[0] = kept;
      this.retainedBytes -= droppedBytes;
      this.dropped += droppedBytes;
    }
  }
}
