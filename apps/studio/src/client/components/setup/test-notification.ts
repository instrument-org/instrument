import { rpcClient } from "@/client/rpc/client";

/** How long a test notification waits for its click before setup stops waiting. */
const CLICK_WAIT_MS = 60_000;

/**
 * The seam the notifications step reaches the test notification through:
 * sends one, and settles `clicked` when the person clicks it, or
 * `timed-out` when the wait passes or the notification couldn't be sent.
 * Neither traps anyone: the page keeps Send again and a quiet Continue.
 */
export async function sendTestNotification(): Promise<"clicked" | "timed-out"> {
  try {
    return await rpcClient.mac.notifications.test.call({
      timeoutMs: CLICK_WAIT_MS,
    });
  } catch {
    return "timed-out";
  }
}
