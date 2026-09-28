import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * How long after the agent's last command a guest still counts as being
 * driven. An agent thinks between commands, sometimes for many seconds, and
 * a mark that drops in a pause reads as the work being done.
 */
const QUIET_MS = 30_000;

/**
 * Whether an agent is driving one guest, whoever the agent is: a tab of the
 * window's handed to a task is driven by that task, not by the window's own
 * conversation, so no run to latch to is known here. The mark holds through a
 * pause and drops after a longer one. The stream says when the guest was
 * last worked in as it is subscribed to, so a tile drawn after the agent
 * opened the tab shows the mark from the start.
 */
export function useTargetAgentActivity(targetId: BrowserTargetId): boolean {
  const lastAt = useTargetAgentLastAt(targetId);

  // A stretch ends when the quiet after its last command runs out with no
  // newer command having moved it: the time it ran out on is the one showing.
  const [quietAt, setQuietAt] = useState<number>();
  useEffect(() => {
    if (lastAt === undefined) {
      return;
    }
    const timeout = window.setTimeout(
      () => {
        setQuietAt(lastAt);
      },
      Math.max(0, lastAt + QUIET_MS - Date.now()),
    );
    return () => {
      window.clearTimeout(timeout);
    };
  }, [lastAt]);

  return lastAt !== undefined && quietAt !== lastAt;
}

/**
 * When an agent last sent one guest a command, in ms, moving with each new
 * one; nothing while none has since launch.
 */
export function useTargetAgentLastAt(
  targetId: BrowserTargetId,
): number | undefined {
  const owner = decodeBrowserTargetId(targetId);
  const { data } = useQuery(
    rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions({
      enabled: owner !== null,
      input: { id: owner?.id ?? ("" as never), targetId },
    }),
  );
  return data?.lastAt;
}
