import { useTaskActivity } from "@/client/hooks/use-task-activity";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Whether the agent has been into this task's browser during the run that is
 * still going.
 *
 * Latched to the run rather than to the traffic. The agent drives the browser
 * from separate tool calls seconds apart and interleaves them with everything
 * else it is doing, so an indicator tracking the commands themselves spends a
 * turn switching on and off while one continuous piece of work goes on behind
 * it. The question worth answering is not "is a command in flight" but "is the
 * thing running, and is the browser part of what it is doing" -- which turns on
 * once and off once.
 *
 * Only the agent's commands reach the stream. The user's own clicking and
 * typing goes straight into the guest, and the panel's controls take a
 * main-process path, so neither can be mistaken for the agent working.
 */
export function useBrowserAgentActivity(taskId: TaskId): boolean {
  const { data } = useQuery(
    rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions({
      input: { id: taskId },
    }),
  );
  const revision = data?.revision ?? 0;
  const isRunning = useIsAgentRunning(taskId);

  // The command count this run began at, so a tick past it is the agent having
  // gone into the browser during this run and every tick before it is a run
  // that is already over. Null while nothing is running.
  const [runStart, setRunStart] = useState<null | number>(null);

  // Adjusted during render rather than from an effect: React re-runs the
  // component before committing, so nothing downstream sees the stale value,
  // and a tick is counted in the same render it arrives in.
  if (!isRunning) {
    if (runStart !== null) {
      setRunStart(null);
    }
  } else if (runStart === null || revision < runStart) {
    // Either a run beginning, or the stream rewinding under one -- it restarts
    // its count for every new subscription, so a baseline from the last one
    // would hold the mark off until the new count climbed past it.
    setRunStart(revision);
  }

  return isRunning && runStart !== null && revision > runStart;
}

/** Whether any of this task's sessions is mid-turn. */
function useIsAgentRunning(taskId: TaskId): boolean {
  const { data: activity } = useTaskActivity({ id: taskId });

  return Boolean(
    activity?.sessionActors.some((actor) =>
      actor.tags.includes("agent.running"),
    ),
  );
}
