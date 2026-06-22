import { rpcClient } from "@/client/rpc/client";
import { useEffect } from "react";

export function useToggleCommandMenu(onToggle: () => void) {
  useEffect(() => {
    let isCancelled = false;

    async function subscribeToToggleTaskLauncher() {
      const subscription = await rpcClient.utils.live.toggleCommandMenu.call();

      for await (const _ of subscription) {
        if (isCancelled) {
          break;
        }

        onToggle();
      }
    }

    void subscribeToToggleTaskLauncher();

    return () => {
      isCancelled = true;
    };
  }, [onToggle]);
}
