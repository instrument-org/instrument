import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";

const subscribe = ({ signal }: { signal: AbortSignal }) =>
  rpcClient.utils.live.toggleCommandMenu.call(undefined, { signal });

export function useToggleCommandMenu(onToggle: () => void) {
  useMainProcessSignal(subscribe, onToggle);
}
