import { rpcClient } from "@/client/rpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Keeps every surface that lists skills current the moment the workspace skills
 * directory changes.
 *
 * A skill the agent just authored is otherwise invisible to the slash menu on
 * the very page that created it until its cache goes stale or the window is
 * refocused, and one it just deleted stays offered there just as long. Mount
 * once per window: the cached list is shared, so one invalidation refreshes the
 * composer, the mention list, and the skills page together, and it only fires
 * on a real change rather than on every turn.
 *
 * The subscription's opening revision is acted on like any other. Changes
 * published while nothing was listening are not replayed, so re-reading on a
 * fresh subscription is what closes the gap a reconnect would otherwise leave.
 */
export function useRefreshSkillsOnChange() {
  const queryClient = useQueryClient();
  const { data } = useQuery(
    rpcClient.workspace.skill.live.changed.experimental_liveOptions(),
  );
  const revision = data?.revision;

  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.skill.list.key(),
    });
  }, [revision, queryClient]);
}
