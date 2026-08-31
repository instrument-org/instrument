import { AsyncLocalStorage } from "node:async_hooks";
import { type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import { BoundedText } from "../bounded-text";
import { utf8Prefix } from "../utf8-byte-slice";

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
    const decoder = new StringDecoder("utf8");
    let partialLine = "";

    for await (const chunk of all) {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
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
