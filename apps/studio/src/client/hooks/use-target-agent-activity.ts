import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";

/**
 * How long after the agent's last command a guest still counts as being
 * driven. An agent thinks between commands, sometimes for many seconds, and
 * a mark that drops in a pause reads as the work being done.
 */
const QUIET_MS = 30_000;

/**
 * Which of some guests an agent is driving, whoever the agent is: a tab of the
 * window's handed to a task is driven by that task, not by the window's own
 * conversation, so no run to latch to is known here. A guest's mark holds
 * through a pause and drops after a longer one. The stream says when a guest
 * was last worked in as it is subscribed to, so a tab drawn after the agent
 * opened it shows the mark from the start.
 */
export function useTargetsAgentActivity(
  targetIds: readonly BrowserTargetId[],
): ReadonlySet<BrowserTargetId> {
  const lastAts = useQueries({
    combine: (results) => results.map((result) => result.data?.lastAt),
    queries: targetIds.map((targetId) =>
      rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions(
        { input: { targetId } },
      ),
    ),
  });

  // A stretch ends when the quiet after its last command runs out with no
  // newer command having moved it: the time it ran out on is the one showing.
  const [quietAt, setQuietAt] = useState<ReadonlyMap<BrowserTargetId, number>>(
    new Map(),
  );
  const stretches = targetIds.flatMap((targetId, index) => {
    const lastAt = lastAts[index];
    return lastAt === undefined ? [] : [{ lastAt, targetId }];
  });
  const stretchKey = stretches
    .map(({ lastAt, targetId }) => `${targetId}@${lastAt}`)
    .join(" ");
  const currentStretches = useEffectEvent(() => stretches);
  useEffect(() => {
    const timeouts = currentStretches().map(({ lastAt, targetId }) =>
      window.setTimeout(
        () => {
          setQuietAt((current) => new Map(current).set(targetId, lastAt));
        },
        Math.max(0, lastAt + QUIET_MS - Date.now()),
      ),
    );
    return () => {
      for (const timeout of timeouts) {
        window.clearTimeout(timeout);
      }
    };
    // Keyed by what the stretches are, since the array is new every render.
  }, [stretchKey]);

  return new Set(
    stretches
      .filter(({ lastAt, targetId }) => quietAt.get(targetId) !== lastAt)
      .map(({ targetId }) => targetId),
  );
}

/**
 * When an agent last sent one guest a command, in ms, moving with each new
 * one; nothing while none has since launch.
 */
export function useTargetAgentLastAt(
  targetId: BrowserTargetId,
): number | undefined {
  const { data } = useQuery(
    rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions({
      input: { targetId },
    }),
  );
  return data?.lastAt;
}
