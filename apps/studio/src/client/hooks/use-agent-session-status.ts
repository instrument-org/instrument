import {
  type SessionTag,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { skipToken } from "@tanstack/react-query";

import { useTaskActivity } from "./use-task-activity";

/**
 * Derives agent status for a specific session within a task app.
 * Replay status is queried automatically by id.
 * Pass `isReplayActive` to additionally treat an external replay signal as
 * live (e.g. for cancel button logic in task-chat).
 */
export function useAgentSessionStatus({
  id,
  isReplayActive = false,
  sessionId,
}: {
  id: TaskId;
  isReplayActive?: boolean;
  sessionId: StoreId.Session | typeof skipToken | undefined;
}) {
  const { data: taskActivity } = useTaskActivity({ id });
  const sessionActors = taskActivity?.sessionActors ?? [];
  const isReplayActiveForSession =
    isReplayActive ||
    (!!sessionId &&
      sessionId !== skipToken &&
      (taskActivity?.activeReplaySessionIds.includes(sessionId) ?? false));

  if (!sessionId || sessionId === skipToken) {
    return { isAgentAlive: isReplayActive, isAgentRunning: isReplayActive };
  }

  const tags = getSessionTags({ sessionActors, sessionId });

  return {
    isAgentAlive: isReplayActiveForSession || isSessionAlive(tags),
    isAgentRunning: isReplayActiveForSession || isSessionRunning(tags),
  };
}

function getSessionTags({
  sessionActors,
  sessionId,
}: {
  sessionActors: { sessionId: StoreId.Session; tags: SessionTag[] }[];
  sessionId: StoreId.Session;
}) {
  return sessionActors.find((a) => a.sessionId === sessionId)?.tags ?? [];
}

function isSessionAlive(tags: SessionTag[]) {
  return tags.includes("agent.alive");
}

function isSessionRunning(tags: SessionTag[]) {
  return tags.includes("agent.running");
}
