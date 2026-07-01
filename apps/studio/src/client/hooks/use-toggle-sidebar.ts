import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";

const subscribe = () => rpcClient.utils.live.toggleSidebar.call();

export function useToggleSidebar(onToggle: () => void) {
  useMainProcessSignal(subscribe, onToggle);
}
