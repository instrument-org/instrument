import { decodeBytesToUtf8Leniently, unsafeBytesFromLatin1 } from "just-bash";
import { AsyncLocalStorage } from "node:async_hooks";
import { type Readable } from "node:stream";

import { BoundedText } from "../bounded-text";
import { utf8Prefix } from "../utf8-byte-slice";

/**
 * A program's output as the shell shows it: UTF-8 decoded, with each byte
 * outside a UTF-8 sequence as the Latin-1 character of its value, the way
 * just-bash decodes a statement's byte output. Diagnostics and the live view
 * of a background run use it, so both read what the final output reads.
 */
export function decodeForDisplay(bytes: Uint8Array): string {
  return decodeBytesToUtf8Leniently(
    unsafeBytesFromLatin1(Buffer.from(bytes).toString("latin1")),
  );
}

/**
 * `decodeForDisplay` over a stream of chunks. A sequence the chunk's last
 * lead byte starts and the chunk cuts short is held for the next one; no
 * sequence spans a lead byte, so the text matches decoding the whole stream
 * at once.
 */
class DisplayDecoder {
  private pending: Uint8Array = new Uint8Array(0);

  write(chunk: Uint8Array): string {
    const data = Buffer.concat([this.pending, chunk]);
    let split = data.length;
    for (let i = data.length - 1; i >= Math.max(0, data.length - 3); i--) {
      const byte = data[i] ?? 0;
      if (byte >= 0xc0) {
        const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
        split = i + length > data.length ? i : data.length;
        break;
      }
    }
    this.pending = data.subarray(split);
    return decodeForDisplay(data.subarray(0, split));
  }

  end(): string {
    const rest = decodeForDisplay(this.pending);
    this.pending = new Uint8Array(0);
    return rest;
  }
}

/**
 * Receives a native subprocess's merged output while it is still running.
 * Called with whole lines (plus whatever partial line remains at exit) so
 * consumers that filter output line-by-line never see a line split across two
 * calls.
 */
export type ShellOutputSink = (text: string) => Promise<void> | void;

/**
 * Async-context-scoped so a background run can opt every native-binary shim
 * beneath it into streaming without threading a sink parameter through the
 * fifteen `create*Command` factories and the just-bash interpreter that calls
 * them. Foreground runs leave the store empty and keep buffering as before.
 */
const storage = new AsyncLocalStorage<ShellOutputSink>();

/**
 * Head and tail retained from a single command's output. Generous, because a
 * foreground command's full output is what the model and the spill file see, but
 * finite: a promoted process can run for hours.
 */
const RETAIN_HEAD_BYTES = 2 * 1024 * 1024;
const RETAIN_TAIL_BYTES = 2 * 1024 * 1024;

/**
 * A line this long with no newline in sight is not a line. Forwarding it splits
 * it, and the sink's redaction is line-anchored, so a `password=` straddling the
 * split would survive. The threshold sits where only pathological output reaches
 * it -- a credential line a megabyte long is not a real shape -- and far below
 * what would exhaust memory waiting for a newline that may never come.
 */
const MAX_PARTIAL_LINE_BYTES = 1024 * 1024;

/**
 * Read a subprocess's merged output stream to completion, forwarding whole lines
 * to `sink` and resolving with the text, bounded to a head and a tail.
 *
 * The stream to pass is one execa tees for a second reader (`subprocess.readable`),
 * not the buffered one execa is consuming itself: two consumers of a single
 * stream split the chunks between them.
 */
export function collectAndForward(
  all: Readable,
  sink: ShellOutputSink,
): Promise<string> {
  return collect();

  async function collect() {
    const collected = new BoundedText({
      headBytes: RETAIN_HEAD_BYTES,
      tailBytes: RETAIN_TAIL_BYTES,
    });
    const decoder = new DisplayDecoder();
    let partialLine = "";

    for await (const chunk of all) {
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? decoder.write(chunk)
            : String(chunk);
      await collectText(text);
    }
    await collectText(decoder.end());

    async function collectText(text: string) {
      if (!text) {
        return;
      }
      collected.write(text);
      partialLine += text;

      for (;;) {
        const lastNewline = partialLine.lastIndexOf("\n");
        if (lastNewline !== -1) {
          await sink(partialLine.slice(0, lastNewline + 1));
          partialLine = partialLine.slice(lastNewline + 1);
          break;
        }
        if (Buffer.byteLength(partialLine, "utf8") <= MAX_PARTIAL_LINE_BYTES) {
          break;
        }
        const forwarded = utf8Prefix(partialLine, MAX_PARTIAL_LINE_BYTES);
        await sink(forwarded);
        partialLine = partialLine.slice(forwarded.length);
      }
    }

    if (partialLine) {
      await sink(partialLine);
    }
    return collected.toString();
  }
}

export function currentShellOutputSink(): ShellOutputSink | undefined {
  return storage.getStore();
}

export function withShellOutputSink<T>(
  sink: ShellOutputSink,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(sink, run);
}
