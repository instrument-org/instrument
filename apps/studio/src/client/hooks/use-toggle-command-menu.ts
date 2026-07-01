import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";

const subscribe = () => rpcClient.utils.live.toggleCommandMenu.call();

export function useToggleCommandMenu(onToggle: () => void) {
  useMainProcessSignal(subscribe, onToggle);
}
