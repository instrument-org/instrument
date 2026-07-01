import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";

const subscribe = () => rpcClient.utils.live.reload.call();

export function useReload(onReload: () => void) {
  useMainProcessSignal(subscribe, onReload);
}
