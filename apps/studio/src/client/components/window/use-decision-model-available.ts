import { rpcClient } from "@/client/rpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Marks the decision model out of reach after a request to it fails, so
 * every search that falls back to it stops asking, and says nothing about
 * looking, until the check above is read again. The providers can say it is
 * there while the request still fails (a sign-in the API refuses, a model
 * it cannot serve), and a search typed key by key would otherwise ask again
 * on every pause.
 */
export function useNoteDecisionModelUnreachable() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.setQueryData(
      rpcClient.workspace.decision.available.queryKey(),
      false,
    );
  };
}
