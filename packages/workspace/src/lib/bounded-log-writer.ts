import fs from "node:fs";

import { utf8Prefix } from "./utf8-byte-slice";

export class BoundedLogWriter {
  get closed(): Promise<void> {
    return this.closedPromise;
  }

  get errorMessage(): string | undefined {
    if (!this.writeError) {
      return undefined;
    }
    const code =
      "code" in this.writeError && typeof this.writeError.code === "string"
        ? ` (${this.writeError.code})`
        : "";
    return `Could not write the background process log${code}.`;
  }

  get omittedBytes(): number {
    return this.droppedBytes;
  }

  private readonly closedPromise: Promise<void>;
  private contentBytes = 0;
  private droppedBytes = 0;
  private ended = false;
  private readonly maxContentBytes: number;
  private readonly stream: fs.WriteStream;
  private writeError?: Error;

  constructor({
    maxContentBytes,
    path,
  }: {
    maxContentBytes: number;
    path: string;
  }) {
    this.maxContentBytes = maxContentBytes;
    this.stream = fs.createWriteStream(path, { flags: "w" });
    this.closedPromise = new Promise((resolve) => {
      this.stream.once("close", resolve);
    });
    this.stream.once("error", (error) => {
      this.writeError = error;
    });
  }

  close(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const marker =
      this.droppedBytes > 0
        ? `\n[${this.droppedBytes} bytes omitted because this background log reached its size limit]\n`
        : "";
    this.stream.end(marker);
  }

  write(text: string): Promise<void> {
    if (!text || this.ended || this.writeError) {
      return Promise.resolve();
    }

    const writtenBytes = Buffer.byteLength(text, "utf8");
    const remaining = Math.max(0, this.maxContentBytes - this.contentBytes);
    const retained = utf8Prefix(text, remaining);
    const retainedBytes = Buffer.byteLength(retained, "utf8");
    this.contentBytes += retainedBytes;
    this.droppedBytes += writtenBytes - retainedBytes;
    if (retainedBytes < writtenBytes) {
      this.contentBytes = this.maxContentBytes;
    }

    if (!retained) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.stream.write(retained, (error) => {
        if (error) {
          this.writeError = error;
        }
        resolve();
      });
    });
  }
}
