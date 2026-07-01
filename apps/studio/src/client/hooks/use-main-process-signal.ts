import { useEffect } from "react";

/**
 * Subscribe to a one-shot main-process signal — a `utils.live.*` event stream
 * fired from menus / keyboard shortcuts — and run `onSignal` each time it fires.
 * Cancels cleanly on unmount. Pass a stable `subscribe` (a module-level constant)
 * so the subscription isn't torn down and rebuilt on every render.
 */
export function useMainProcessSignal(
  subscribe: () => Promise<AsyncIterable<unknown>>,
  onSignal: () => void,
) {
  useEffect(() => {
    let isCancelled = false;

    async function run() {
      const subscription = await subscribe();
      for await (const _ of subscription) {
        if (isCancelled) {
          break;
        }
        onSignal();
      }
    }

    void run();

    return () => {
      isCancelled = true;
    };
  }, [subscribe, onSignal]);
}
