import fs from "node:fs/promises";
import path from "node:path";

const MAX_ENTRY_BYTES = 64 * 1024;
const MAX_PENDING_BYTES = 1024 * 1024;
const TRUNCATED = " [log entry truncated]\n";

/** A UTF-8 entry, including its newline, bounded before it enters a queue. */
export function boundedLogLine(text: string): string {
  const buffer = Buffer.from(text.endsWith("\n") ? text : `${text}\n`);
  if (buffer.length <= MAX_ENTRY_BYTES) {
    return buffer.toString();
  }
  let end = MAX_ENTRY_BYTES - Buffer.byteLength(TRUNCATED);
  while (((buffer[end] ?? 0) & 0xc0) === 0x80) {
    end--;
  }
  return buffer.subarray(0, end).toString() + TRUNCATED;
}

/**
 * Serialized writes rotate before appending; pending bytes include the active
 * write. Every line queued by the time a write starts goes in that one
 * write: macOS counts each append as a whole page dirtied (16 KB for a
 * 250-byte line), so a line per append multiplies the disk writes it charges
 * the app by up to sixty.
 */
export function createRotatingLogWriter(
  filePath: () => string,
  maxBytes: number,
) {
  const queue: string[] = [];
  let pendingBytes = 0;
  let retryAt = 0;
  let draining: Promise<void> | undefined;
  let size: number | undefined;

  async function drain() {
    try {
      // Lets the lines logged in the same task as the first join it.
      await Promise.resolve();
      const file = filePath();
      const parsed = path.parse(file);
      const archive = path.join(parsed.dir, `${parsed.name}.old${parsed.ext}`);
      if (size === undefined) {
        await fs.mkdir(parsed.dir, { recursive: true });
        size = await fs.stat(file).then(
          (stat) => stat.size,
          (error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              return 0;
            }
            throw error;
          },
        );
        // Repair oversized files before retaining an archive.
        for (const candidate of [file, archive]) {
          const stat = await fs.stat(candidate).catch(() => undefined);
          if (stat && stat.size > maxBytes) {
            await fs.truncate(candidate, maxBytes);
            if (candidate === file) size = maxBytes;
          }
        }
      }
      while (queue.length > 0) {
        const first = queue[0];
        if (first === undefined) break;
        if (size + Buffer.byteLength(first) > maxBytes) {
          await fs.rm(archive, { force: true });
          await fs.rename(file, archive);
          size = 0;
        }
        // The queued lines that fit before the next rotation, the first always.
        let count = 0;
        let bytes = 0;
        for (const line of queue) {
          const lineBytes = Buffer.byteLength(line);
          if (count > 0 && size + bytes + lineBytes > maxBytes) break;
          count += 1;
          bytes += lineBytes;
        }
        await fs.appendFile(file, queue.slice(0, count).join(""));
        size += bytes;
        pendingBytes -= bytes;
        queue.splice(0, count);
      }
    } catch {
      // Logging a failed log write can recursively fill the same disk.
      retryAt = Date.now() + 60_000;
      size = undefined;
      queue.length = 0;
      pendingBytes = 0;
    }
  }

  return {
    write(text: string) {
      if (Date.now() < retryAt) return;
      const line = boundedLogLine(text);
      const bytes = Buffer.byteLength(line);
      if (pendingBytes + bytes > MAX_PENDING_BYTES) return;
      pendingBytes += bytes;
      queue.push(line);
      draining ??= drain().finally(() => {
        draining = undefined;
      });
    },
    async flush() {
      await draining;
    },
  };
}
