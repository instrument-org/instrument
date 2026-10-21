import { rpcClient } from "@/client/rpc/client";

/**
 * Passes the window's `online` and `offline` events to main, which asks the
 * OS again and keeps the one status every window shows.
 */
export function initNetworkStatusForwarding() {
  const recheck = () => {
    void rpcClient.network.recheck.call().catch(() => null);
  };
  window.addEventListener("online", recheck);
  window.addEventListener("offline", recheck);
}
