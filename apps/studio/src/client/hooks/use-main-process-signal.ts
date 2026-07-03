import { sleep } from "radashi";
import { useEffect, useRef } from "react";

// Backoff before re-establishing a dropped signal stream, so a transport reset
// (e.g. a renderer hot reload) doesn't spin.
const RECONNECT_DELAY_MS = 500;

/**
 * Subscribe to a one-shot main-process signal -- a `utils.live.*` event stream
 * fired from menus / keyboard shortcuts -- and run `onSignal` each time it
 * fires. Aborts deterministically on unmount (the `signal` is forwarded to
 * `.call()`, so the server generator stops too) and reconnects if the stream
 * drops, so a hot reload can't leave the shortcut unwired. `onSignal` is read
 * through a ref, so passing a fresh callback each render never resubscribes.
 */
export function useMainProcessSignal(
  subscribe: (options: {
    signal: AbortSignal;
  }) => Promise<AsyncIterable<unknown>>,
  onSignal: () => void,
) {
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      while (!signal.aborted) {
        try {
          const subscription = await subscribe({ signal });
          for await (const _ of subscription) {
            onSignalRef.current();
          }
        } catch {
          // Stream dropped (transport reset, hot reload); reconnect below unless
          // we're tearing down.
        }
        if (signal.aborted) {
          break;
        }
        await sleep(RECONNECT_DELAY_MS);
      }
    }

    void run();

    return () => {
      controller.abort();
    };
  }, [subscribe]);
}
