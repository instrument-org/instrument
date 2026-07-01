import { openSettings } from "@/client/atoms/settings-modal";
import { rpcClient } from "@/client/rpc/client";
import { useEffect } from "react";

/**
 * Opens the settings modal when the native app menu's "Settings..." item
 * (Cmd+,) fires in the main process, which publishes over this subscription.
 */
export function useOpenSettings() {
  useEffect(() => {
    let isCancelled = false;

    async function subscribe() {
      const subscription = await rpcClient.utils.live.openSettings.call();

      for await (const _ of subscription) {
        if (isCancelled) {
          break;
        }
        openSettings({ tab: "General" });
      }
    }

    void subscribe();

    return () => {
      isCancelled = true;
    };
  }, []);
}
