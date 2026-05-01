import {
  type ProjectSubdomain,
  type SessionTag,
} from "@instrument-org/workspace/client";
import { PauseIcon } from "@phosphor-icons/react";
import { skipToken, useQuery } from "@tanstack/react-query";

import { useAppState } from "../hooks/use-app-state";
import { useDeveloperMode } from "../hooks/use-developer-mode";
import { cn } from "../lib/utils";
import { rpcClient } from "../rpc/client";
import { Spinner } from "./ui/spinner";

export function AppStatusIcon({
  className,
  subdomain,
}: {
  className?: string;
  subdomain: ProjectSubdomain;
}) {
  const isDeveloperMode = useDeveloperMode();
  const { data: appState } = useAppState({ subdomain });
  const { data: replayStatus } = useQuery(
    rpcClient.workspace.debug.live.replayStatusBySubdomain.experimental_liveOptions(
      {
        input: isDeveloperMode ? { subdomain } : skipToken,
      },
    ),
  );

  const tags = appState?.sessionActors.flatMap((a) => a.tags) ?? [];
  const isReplayRunning = (replayStatus?.activeSessionIds.length ?? 0) > 0;

  return (
    <SessionStatusIcon
      className={className}
      isReplayRunning={isReplayRunning}
      tags={tags}
    />
  );
}

export function SessionStatusIcon({
  className = "h-4 w-4",
  isReplayRunning = false,
  tags,
}: {
  className?: string;
  isReplayRunning?: boolean;
  tags: SessionTag[];
}) {
  switch (true) {
    case tags.includes("agent.paused"): {
      return (
        <PauseIcon
          className={cn(className, "text-warning-700 dark:text-warning-300")}
        />
      );
    }
    case tags.includes("agent.running") || isReplayRunning: {
      return <Spinner className={className} />;
    }
    default: {
      return null;
    }
  }
}
