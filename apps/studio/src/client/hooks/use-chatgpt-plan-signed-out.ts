import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Whether the ChatGPT plan is known to be signed out, which is the only time
 * a missing plan model is the account's doing. A plan model missing from a
 * list while signed in is that list's gap (a refetch in flight, a catalog
 * that failed to load), not a reason to tell someone to sign in again.
 */
export function useChatGPTPlanSignedOut(): boolean {
  const { data: status } = useQuery(
    rpcClient.chatgptPlan.live.status.experimental_liveOptions(),
  );
  return status?.state === "signed-out" || status?.state === "plan-disabled";
}
