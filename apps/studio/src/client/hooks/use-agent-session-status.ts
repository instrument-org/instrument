import {
  type SessionTag,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  skipToken,
  useQuery,
} from "@tanstack/react-query";

import {
  rpcClient,
} from "../rpc/client";
import {
  useAppState,
} from "./use-app-state";

export function getSessionTags({
  sessionActors,
  sessionId,
}: {
  sessionActors: { sessionId: string; tags: SessionTag[] }[];
  sessionId: string;
}) {
  return sessionActors.find((a) => a.sessionId === sessionId)?.tags ?? [];
}

/**
 * Derives agent status for a specific session within a project app.
 * Replay status is queried automatically by subdomain.
 * Pass `isReplayActive` to additionally treat an external replay signal as
 * live (e.g. for cancel button logic in project-chat).
 */
export function useAgentSessionStatus({
  isReplayActive = false,
  sessionId,
  subdomain,
}: {
  isReplayActive?: boolean;
  sessionId: StoreId.Session | typeof skipToken | undefined;
  subdomain: TaskId;
}) {
  const { data: appState } = useAppState({ subdomain });
  const sessionActors = appState?.sessionActors ?? [];

  const { data: replayStatus } = useQuery(
    rpcClient.workspace.replay.live.statusBySubdomain.experimental_liveOptions({
      input: sessionId && sessionId !== skipToken ? { subdomain } : skipToken,
    }),
  );
  const isReplayActiveForSession =
    isReplayActive ||
    (!!sessionId &&
      sessionId !== skipToken &&
      (replayStatus?.activeSessionIds.includes(sessionId) ?? false));

  if (!sessionId || sessionId === skipToken) {
    return { isAgentAlive: isReplayActive, isAgentRunning: isReplayActive };
  }

  const tags = getSessionTags({ sessionActors, sessionId });

  return {
    isAgentAlive: isReplayActiveForSession || isSessionAlive(tags),
    isAgentRunning: isReplayActiveForSession || isSessionRunning(tags),
  };
}

function isSessionAlive(tags: SessionTag[]) {
  return tags.includes("agent.alive");
}

function isSessionRunning(tags: SessionTag[]) {
  return tags.includes("agent.running");
}
