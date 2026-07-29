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
    rpcClient.workspace.skill.live.changed.experimental_liveOptions(),
  );
  const revision = data?.revision;

  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    // The router's own key, so this covers every skill read rather than the
    // list alone: someone watching a skill's page while the agent revises it
    // is looking at `byName` and `file`, which the list key never touched.
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.skill.key(),
    });
  }, [revision, queryClient]);
}
