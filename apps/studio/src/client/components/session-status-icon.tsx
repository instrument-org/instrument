import { type SessionTag, type TaskId } from "@instrument-org/workspace/client";
import { PauseIcon } from "@phosphor-icons/react/Pause";

import { useTaskActivity } from "../hooks/use-task-agent-status";
import { cn } from "../lib/utils";
import { Spinner } from "./ui/spinner";

export function TaskStatusIcon({
  className,
  id,
}: {
  className?: string;
  id: TaskId;
}) {
  const { data: taskActivity } = useTaskActivity({ id });

  const tags = taskActivity?.sessionActors.flatMap((a) => a.tags) ?? [];
  const isReplayRunning =
    (taskActivity?.activeReplaySessionIds.length ?? 0) > 0;

  return (
    <SessionStatusIcon
      className={className}
      isReplayRunning={isReplayRunning}
      tags={tags}
    />
  );
}

function SessionStatusIcon({
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
