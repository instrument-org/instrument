import { openSettings } from "@/client/atoms/settings-modal";
import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";
import { useCallback } from "react";

const subscribe = () => rpcClient.utils.live.openSettings.call();

/**
 * Opens the settings modal when the native app menu's "Settings..." item
 * (Cmd+,) fires in the main process, which publishes over this subscription.
 */
export function useOpenSettings() {
  useMainProcessSignal(
    subscribe,
    useCallback(() => {
      openSettings({ tab: "General" });
    }, []),
  );
}
