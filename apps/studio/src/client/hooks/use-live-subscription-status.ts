import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export function useLiveSubscriptionStatus({
  input,
}: {
  input?: RPCInput["user"]["live"]["subscriptionStatus"];
} = {}) {
  const { refetch, ...rest } = useQuery(
    rpcClient.user.live.subscriptionStatus.experimental_liveOptions({
      input: input ?? {},
    }),
  );
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );

  useEffect(() => {
    void refetch();
  }, [windowFocusChanged, refetch]);

  return { ...rest, refetch };
}
