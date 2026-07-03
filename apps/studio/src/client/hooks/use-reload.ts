import { useMainProcessSignal } from "@/client/hooks/use-main-process-signal";
import { rpcClient } from "@/client/rpc/client";

const subscribe = ({ signal }: { signal: AbortSignal }) =>
  rpcClient.utils.live.reload.call(undefined, { signal });

export function useReload(onReload: () => void) {
  useMainProcessSignal(subscribe, onReload);
}
