import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

export function useDeveloperMode() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  return preferences?.developerMode ?? false;
}
