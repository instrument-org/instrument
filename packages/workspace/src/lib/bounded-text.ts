import { ChunkWindow } from "./chunk-window";
import { utf8Prefix } from "./utf8-byte-slice";

/**
 * Accumulates text under a hard byte ceiling by keeping the head and the tail and
 * dropping the middle, counting what it dropped.
 *
 * For anything that accumulates a running process's output: a dev server left
 * running for an hour, or a single read waiting ten minutes on a chatty build,
 * produces an unbounded amount of text, and the process holding it is Studio's
 * main process. Head plus tail is the right shape because the two ends are what
 * diagnose a command: what it was doing when it started, and what it was doing
 * when it stopped.
 */
export class BoundedText {
  /** Bytes dropped from the middle. */
  get omittedBytes(): number {
    return this.tail.omittedBytes;
  }
  get retainedBytes(): number {
    return this.headBytes + this.tail.bytes;
  }
  private head: string[] = [];
  private headBytes = 0;
  private headComplete = false;

  private readonly headLimit: number;

  /** Evicted from the front, which is what makes the middle the part that goes. */
  private readonly tail: ChunkWindow;

  constructor({
    headBytes,
    tailBytes,
  }: {
    headBytes: number;
    tailBytes: number;
  }) {
    this.headLimit = headBytes;
    this.tail = new ChunkWindow(tailBytes);
  }

  /** Retained text, with a marker where the middle was dropped. */
  toString(marker = (bytes: number) => `\n[... ${bytes} bytes omitted ...]\n`) {
    const omitted = this.tail.omittedBytes;
    if (omitted === 0) {
      return this.head.join("") + this.tail.peek();
    }
    return this.head.join("") + marker(omitted) + this.tail.peek();
  }

  write(text: string): void {
    if (!text) {
      return;
    }
    // Fill the head first; it is never evicted, so early output survives however
    // long the process runs.
    if (!this.headComplete && this.headBytes < this.headLimit) {
      const headText = utf8Prefix(text, this.headLimit - this.headBytes);
      if (headText) {
        this.head.push(headText);
        this.headBytes += Buffer.byteLength(headText, "utf8");
        text = text.slice(headText.length);
      }
      if (!text) {
        return;
      }
      this.headComplete = true;
    }

    this.tail.write(text);
  }
}
