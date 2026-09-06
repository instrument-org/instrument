import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** How long after the last command a guest still counts as being driven. */
const QUIET_MS = 8000;

/**
 * Whether an agent is driving one guest, whoever the agent is: a tab of the
 * window's handed to a task is driven by that task, not by the window's own
 * conversation, so no run to latch to is known here. The commands arrive
 * seconds apart, so the mark holds through a short quiet and drops after a
 * longer one.
 */
export function useTargetAgentActivity(targetId: BrowserTargetId): boolean {
  const owner = decodeBrowserTargetId(targetId);
  const { data } = useQuery(
    rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions({
      enabled: owner !== null,
      input: { id: owner?.id ?? ("" as never), targetId },
    }),
  );
  const revision = data?.revision ?? 0;

  // A stretch ends when the clock started by the last command runs out with
  // no newer one having restarted it: the revision the clock ran out on is
  // the one now showing. Revision 0 is the subscription starting, not a
  // command.
  const [quietRevision, setQuietRevision] = useState(0);
  useEffect(() => {
    if (revision === 0) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setQuietRevision(revision);
    }, QUIET_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [revision]);

  return revision !== 0 && quietRevision !== revision;
}
