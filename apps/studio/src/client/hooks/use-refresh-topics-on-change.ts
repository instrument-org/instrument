import { rpcClient } from "@/client/rpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Keeps every surface that lists topics current when a topic's folder
 * changes on disk: one renamed or retired in the person's files, its
 * instructions edited there or by the agent. Mount once per window: the
 * cached reads are shared, so one invalidation refreshes the inbox, the
 * chat heads and a topic's details together. Like the skills' hook, the
 * subscription's opening revision is acted on too, which re-reads after a
 * reconnect.
 */
export function useRefreshTopicsOnChange() {
  const queryClient = useQueryClient();
  const { data } = useQuery(
    rpcClient.workspace.topics.events.changed.experimental_liveOptions(),
  );
  const revision = data?.revision;

  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.topics.key(),
    });
  }, [revision, queryClient]);
}
