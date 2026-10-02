import { ChunkWindow } from "./chunk-window";

/**
 * Output for one background process that no read has taken yet.
 *
 * Reads drain: each one returns only what arrived since the last, so polling a
 * chatty dev server costs the new lines rather than the whole log again. Nothing
 * guarantees the agent ever polls, though, so the buffer drops its oldest
 * chunks past `capBytes` and reports how many bytes went with them; the full
 * output is still recoverable from the process's log file.
 */
export class BackgroundOutputBuffer {
  /** Bytes written since the process started, drained or not. */
  get totalBytes(): number {
    return this.producedBytes;
  }

  private readonly pending: ChunkWindow;

  private producedBytes = 0;

  constructor({ capBytes }: { capBytes: number }) {
    this.pending = new ChunkWindow(capBytes);
  }

  drain(): { omittedBytes: number; text: string } {
    return this.pending.take();
  }

  hasPending(): boolean {
    return this.pending.bytes > 0 || this.pending.omittedBytes > 0;
  }

  /**
   * Bytes dropped so far and not yet reported by a drain. A log seeded at
   * promotion cannot recover them, so the log says they are missing.
   */
  omittedBytesSoFar(): number {
    return this.pending.omittedBytes;
  }

  /** Pending text, left in place. For seeding a log file at promotion. */
  snapshot(): string {
    return this.pending.peek();
  }

  write(text: string): void {
    if (!text) {
      return;
    }
    this.producedBytes += Buffer.byteLength(text, "utf8");
    this.pending.write(text);
  }
}
