import { captureException } from "@/client/lib/capture-exception";
import { sleep } from "radashi";

// Before a stream that dropped is opened again, so one that fails at once
// doesn't spin.
const RECONNECT_DELAY_MS = 500;

/**
 * Hands on each thing an event stream sends, one at a time, until `signal`
 * stops it. A stream that fails or ends is opened again, and a thing that
 * could not be handled costs only itself: both are reported and the
 * listening goes on.
 */
export async function keepListening<T>({
  onEach,
  signal,
  start,
}: {
  onEach: (sent: T) => Promise<void> | void;
  signal: AbortSignal;
  start: (signal: AbortSignal) => Promise<AsyncIterable<T>>;
}) {
  while (!signal.aborted) {
    try {
      for await (const sent of await start(signal)) {
        try {
          await onEach(sent);
        } catch (error) {
          captureException(error);
        }
      }
    } catch (error) {
      // An aborted stream throws as it goes.
      if (!signal.aborted) {
        captureException(error);
      }
    }
    if (!signal.aborted) {
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}
