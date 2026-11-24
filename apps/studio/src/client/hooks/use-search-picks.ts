import { rpcClient } from "@/client/rpc/client";
import { addPick, type PickLog } from "@/shared/remembered-picks";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";

const NO_PICKS: PickLog = [];

/**
 * What the person picked for what they typed in the command menu and a new
 * tab's box, which this computer keeps (`history.searchPicks`), and the way
 * to add to it. Read again each time a search comes up (`enabled`), so a
 * pick made in another window counts.
 */
export function useSearchPicks({ enabled }: { enabled: boolean }): {
  log: PickLog;
  /** The person ran the row with this id after typing these words. */
  note: (typed: string, picked: string) => void;
} {
  const queryClient = useQueryClient();
  const options = rpcClient.history.searchPicks.queryOptions({
    input: enabled ? undefined : skipToken,
    staleTime: 0,
  });
  const picks = useQuery(options);
  return {
    log: picks.data ?? NO_PICKS,
    note: (typed, picked) => {
      queryClient.setQueryData(options.queryKey, (log) =>
        addPick(log ?? NO_PICKS, { at: Date.now(), picked, typed }),
      );
      void rpcClient.history.noteSearchPicked
        .call({ picked, typed })
        .catch(() => null);
    },
  };
}
