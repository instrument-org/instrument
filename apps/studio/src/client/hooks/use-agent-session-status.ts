import {
  type SessionTag,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { skipToken } from "@tanstack/react-query";

import { useTaskActivity } from "./use-task-activity";

/** Derives agent status for a specific session within a task. */
export function useAgentSessionStatus({
  id,
  sessionId,
}: {
  id: TaskId;
  sessionId: StoreId.Session | typeof skipToken | undefined;
}) {
  const { data: taskActivity } = useTaskActivity({ id });
  const sessionActors = taskActivity?.sessionActors ?? [];

  if (!sessionId || sessionId === skipToken) {
    return { isAgentAlive: false, isAgentRunning: false };
  }

  const tags = getSessionTags({ sessionActors, sessionId });

  return {
    isAgentAlive: isSessionAlive(tags),
    isAgentRunning: isSessionRunning(tags),
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
