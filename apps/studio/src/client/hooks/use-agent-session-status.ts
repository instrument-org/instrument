import {
  type AppSubdomain,
  type SessionTag,
} from "@instrument-org/workspace/client";
import { skipToken } from "@tanstack/react-query";

import { useAppState } from "./use-app-state";

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
 * Derives agent status for a specific session within an app.
 * Pass `isReplayActive: true` to treat a replay as a live agent.
 */
export function useAgentSessionStatus({
  isReplayActive = false,
  sessionId,
  subdomain,
}: {
  isReplayActive?: boolean;
  sessionId: string | typeof skipToken | undefined;
  subdomain: AppSubdomain;
}) {
  const { data: appState } = useAppState({ subdomain });
  const sessionActors = appState?.sessionActors ?? [];

  if (!sessionId || sessionId === skipToken) {
    return { isAgentAlive: isReplayActive, isAgentRunning: isReplayActive };
  }

  const tags = getSessionTags({ sessionActors, sessionId });

  return {
    isAgentAlive: isReplayActive || isSessionAlive(tags),
    isAgentRunning: isReplayActive || isSessionRunning(tags),
  };
}

function isSessionAlive(tags: SessionTag[]) {
  return tags.includes("agent.alive");
}

function isSessionRunning(tags: SessionTag[]) {
  return tags.includes("agent.running");
}
