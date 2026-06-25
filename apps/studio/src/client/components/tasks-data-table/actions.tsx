import type { ProjectId, TaskId } from "@instrument-org/workspace/client";

import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useTaskAgentStatus } from "@/client/hooks/use-task-agent-status";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowUpRightIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  PushPinIcon,
  StopCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { TaskProjectMenuItem } from "../project/task-project-menu-item";

export function TaskActionsCell({
  id,
  onDelete,
  onOpenInNewTab,
  onSettings,
  onStop,
  projectId,
}: {
  id: TaskId;
  onDelete: (id: TaskId) => void;
  onOpenInNewTab: (id: TaskId) => void;
  onSettings: (id: TaskId) => void;
  onStop: (id: TaskId) => void;
  projectId: null | ProjectId | undefined;
}) {
  const { data: taskAgentStatus } = useTaskAgentStatus({ id });
  const sessionActors = taskAgentStatus?.sessionActors ?? [];
  const isRunning = sessionActors.some((actor) =>
    actor.tags.includes("agent.alive"),
  );

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions(),
  );
  const isPinned = pinnedTaskIds?.includes(id);

  const { mutateAsync: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions(),
  );

  const { mutateAsync: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions(),
  );

  return (
    <div className="flex items-center justify-end gap-x-1">
      {isRunning && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={(e) => {
                e.preventDefault();
                onStop(id);
              }}
              size="icon"
              variant="ghost"
            >
              <StopCircleIcon className="size-4" weight="fill" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={(e) => {
              e.preventDefault();
              onDelete(id);
            }}
            size="icon"
            variant="ghost"
          >
            <TrashIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost">
            <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              if (isPinned) {
                void removePin({ id });
              } else {
                void addPin({ id });
              }
            }}
          >
            <PushPinIcon className="text-muted-foreground" />
            <span>{isPinned ? "Unpin" : "Pin"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onSettings(id);
            }}
          >
            <PencilSimpleLineIcon className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onOpenInNewTab(id);
            }}
          >
            <ArrowUpRightIcon className="text-muted-foreground" />
            <span>Open in new tab</span>
          </DropdownMenuItem>
          <TaskProjectMenuItem currentProjectId={projectId} taskId={id} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
