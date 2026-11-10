import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

/**
 * How far back a command still counts for a stretch of work already under
 * way when this is first drawn, whose start nothing here saw: the window it
 * is drawn in opened, or the chat came up, mid-turn.
 */
const JOINED_LATE_MS = 30_000;

/**
 * Which of some guests an agent is using: one it sent a command since the
 * chat's work began, while a session with a turn running is at work in it
 * (`inUse`: of the tabs that session drove, the one it drove last), and only
 * while the chat or any task of it is at work (`isWorking`). A pause between
 * commands, however long, keeps the mark; it moves with the agent to the
 * next tab it works in and goes the moment the work stops. A tab of the
 * window's handed to a task is the task's, which the chat's work includes.
 * The stream says when a guest was last worked in as it is subscribed to, so
 * a tab drawn after the agent opened it shows the mark from the start.
 */
export function useTargetsAgentActivity(
  targetIds: readonly BrowserTargetId[],
  isWorking: boolean,
): ReadonlySet<BrowserTargetId> {
  const lastAts = useQueries({
    combine: (results) =>
      results.map((result) =>
        result.data?.inUse === false ? undefined : result.data?.lastAt,
      ),
    queries: targetIds.map((targetId) =>
      rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions(
        { input: { targetId } },
      ),
    ),
  });

  // When the work going on began, as this saw it start.
  const [since, setSince] = useState(() => Date.now() - JOINED_LATE_MS);
  const wasWorking = useRef(isWorking);
  useEffect(() => {
    if (isWorking && !wasWorking.current) {
      setSince(Date.now());
    }
    wasWorking.current = isWorking;
  }, [isWorking]);

  if (!isWorking) {
    return new Set();
  }
  return new Set(
    targetIds.filter((_, index) => {
      const lastAt = lastAts[index];
      return lastAt !== undefined && lastAt >= since;
    }),
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
