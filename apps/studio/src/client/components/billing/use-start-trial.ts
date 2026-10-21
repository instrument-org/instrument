import { platformRefusalCode } from "@/client/lib/billing";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Starts the account's free trial, the only way it starts. The status the
 * API answers with stands in for the next read, so every surface sees the
 * trial at once, and the decision model is asked again whether it can answer.
 */
export function useStartTrial({ onStarted }: { onStarted?: () => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation(
    rpcClient.billing.startTrial.mutationOptions({
      onError: (error) => {
        toast.error(
          platformRefusalCode(error) === "trial-capacity"
            ? "Free trials are full right now. Choose a plan to keep going."
            : "Couldn't start your free trial",
          { cause: error },
        );
      },
      onSuccess: (status) => {
        queryClient.setQueriesData(
          { queryKey: rpcClient.billing.status.key() },
          status,
        );
        void queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.decision.available.queryKey(),
        });
        onStarted?.();
      },
    }),
  );
}
