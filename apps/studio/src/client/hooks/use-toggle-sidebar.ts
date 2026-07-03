import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";

const subscribe = ({ signal }: { signal: AbortSignal }) =>
  rpcClient.utils.live.toggleSidebar.call(undefined, { signal });

export function useToggleSidebar(onToggle: () => void) {
  useMainProcessSignal(subscribe, onToggle);
}
