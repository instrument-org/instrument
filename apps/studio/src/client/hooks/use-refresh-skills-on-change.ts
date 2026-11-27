import { rpcClient } from "@/client/rpc/client";
import {
  hashKey,
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Keeps every surface that lists skills current the moment the workspace skills
 * directory changes.
 *
 * A skill the agent just authored is otherwise invisible to the slash menu on
 * the very page that created it until its cache goes stale or the window is
 * refocused, and one it just deleted stays offered there just as long. Mount
 * once per window: the cached reads are shared, so one invalidation refreshes
 * the composer, the mention list, the skills page and an open skill's own page
 * together, and it only fires on a real change rather than on every turn.
 *
 * The subscription's opening revision is acted on like any other. Changes
 * published while nothing was listening are not replayed, so re-reading on a
 * fresh subscription is what closes the gap a reconnect would otherwise leave.
 */
export function useRefreshSkillsOnChange() {
  const queryClient = useQueryClient();
  const { data } = useQuery(
    rpcClient.workspace.skill.events.changed.experimental_liveOptions(),
  );
  const revision = data?.revision;

  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    void refreshSkills(queryClient);
  }, [revision, queryClient]);
}

/**
 * Reads every skill read again, and returns once they are read. Under the
 * router's own key, so it covers each one, but for `events.changed` itself:
 * reading that again restarts its stream, which loses a change said while it
 * is down, and its fresh revision 0 matches the last one's, so nothing reads
 * again for it. Its refetch also lasts as long as the stream, so awaiting it
 * never returns.
 */
export function refreshSkills(queryClient: QueryClient) {
  const changes = hashKey(
    rpcClient.workspace.skill.events.changed.experimental_liveKey(),
  );
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryHash !== changes,
    queryKey: rpcClient.workspace.skill.key(),
  });
}
