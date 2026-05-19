import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export function useLiveEntitlements({
  input,
}: {
  input?: RPCInput["user"]["live"]["entitlements"];
} = {}) {
  const { refetch, ...rest } = useQuery(
    rpcClient.user.live.entitlements.experimental_liveOptions({
      input: input ?? {},
    }),
  );
  const { data: onWindowFocus } = useQuery(
    rpcClient.utils.live.onWindowFocus.experimental_liveOptions(),
  );

  useEffect(() => {
    void refetch();
  }, [onWindowFocus, refetch]);

  return { ...rest, refetch };
}
