import { captureException } from "@/client/lib/telemetry";
import { rpcClient } from "@/client/rpc/client";
import { sleep } from "radashi";
import { toast } from "sonner";

// Backoff before re-establishing a dropped stream so a hard transport failure
// doesn't spin.
const RECONNECT_DELAY_MS = 500;

/**
 * Says why a page in a tab the agent is driving stayed where it was.
 *
 * While an agent drives a tab, a page it can read may not take the tab to a
 * file outside the agent's folders, whoever clicked the link. The page just
 * stays put, so the window hosting the guest says what happened and how to
 * get there anyway.
 */
export function initBrowserNavigationNotices(): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  async function run() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription =
          await rpcClient.browser.events.navigationRefused.call(undefined, {
            signal,
          });
        for await (const _refused of subscription) {
          toast("That file is outside the folders Instrument can use here", {
            description: "Open it from Files, or from the address bar.",
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        captureException(error);
      }
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  void run();

  return () => {
    controller.abort();
  };
}
