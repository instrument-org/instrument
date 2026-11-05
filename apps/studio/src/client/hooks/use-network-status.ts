import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/** Whether this computer is online and Instrument's servers answer. */
export function useNetworkStatus() {
  const { data } = useQuery(
    rpcClient.network.live.status.experimental_liveOptions({}),
  );
  return data;
}
