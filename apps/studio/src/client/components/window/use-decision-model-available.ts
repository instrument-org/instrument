import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/**
 * Whether the decision model could answer at all, read off the workspace's
 * providers: false with no Instrument sign-in and no OpenRouter key, so a
 * search by meaning is not asked and no "looking" is shown for it, and false
 * too when the check itself fails. Undefined until known, which a caller
 * treats as maybe. Read again after a short while when asked for, since
 * signing in changes it.
 */
export function useDecisionModelAvailable(enabled: boolean) {
  const available = useQuery(
    rpcClient.workspace.decision.available.queryOptions({
      enabled,
      retry: false,
      staleTime: ms("10 seconds"),
    }),
  );
  // A check that fails is no answer to wait on: nothing is asked, rather
  // than a "looking" that never ends.
  return available.isError ? false : available.data;
}
