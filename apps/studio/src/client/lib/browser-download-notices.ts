import { WINDOW_BROWSER_HOST } from "@/client/lib/browser-host";
import { captureException } from "@/client/lib/telemetry";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { sleep } from "radashi";
import { toast } from "sonner";

// Backoff before re-establishing a dropped stream so a hard transport failure
// doesn't spin.
const RECONNECT_DELAY_MS = 500;

/**
 * Says where a download a person started in a browser panel ended up.
 *
 * The guest is a `<webview>`, so a click on a download link in it shows
 * nothing of its own: no bar, no sheet, no badge. The main process saves the
 * file into the task's downloads folder and reports it here, and the window
 * hosting that guest is the one to say so, since it is the window the click
 * happened in.
 */
export function initBrowserDownloadNotices(): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  async function run() {
    while (true) {
      if (signal.aborted) {
        return;
      }
      try {
        const subscription =
          await rpcClient.browser.events.downloadFinished.call(undefined, {
            signal,
          });
        for await (const download of subscription) {
          if (download.host !== WINDOW_BROWSER_HOST) {
            continue;
          }
          if (!download.completed) {
            toast.error(`Couldn't download ${download.filename}`);
            continue;
          }
          toast.success(`Downloaded ${download.filename}`, {
            action: {
              label: getRevealInFolderLabel(),
              onClick: () => {
                void reveal(download.path);
              },
            },
            description: "Saved in this task's downloads folder",
          });
        }
      } catch (error) {
        // Read through `controller` so control-flow analysis doesn't narrow the
        // loop-top guard's `signal.aborted` to a constant false here: abort can
        // flip it across the await, which is exactly the teardown case.
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

async function reveal(filepath: string) {
  const [error] = await safe(
    rpcClient.utils.showFileInFolder.call({ filepath }),
  );
  if (error) {
    toast.error("That file is no longer on disk.");
  }
}
