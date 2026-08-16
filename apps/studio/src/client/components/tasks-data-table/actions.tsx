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
import { useTaskActivity } from "@/client/hooks/use-task-activity";
import { rpcClient } from "@/client/rpc/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PencilSimpleLineIcon } from "@phosphor-icons/react/PencilSimpleLine";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { TaskProjectMenuItem } from "../project/task-project-menu-item";
import { dropdownMenuComponents } from "../ui/menu-components";

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
  const { data: taskActivity } = useTaskActivity({ id });
  const sessionActors = taskActivity?.sessionActors ?? [];
  const isRunning = sessionActors.some((actor) =>
    actor.tags.includes("agent.alive"),
  );

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions(),
  );
  const isPinned = pinnedTaskIds?.includes(id);

  const { mutate: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions({
      onError: (error) => {
        toast.error("Failed to unpin task", { description: error.message });
      },
    }),
  );

  const { mutate: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions({
      onError: (error) => {
        toast.error("Failed to pin task", { description: error.message });
      },
    }),
  );

  return (
    <div className="flex items-center justify-end gap-x-1">
      {isRunning && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Stop"
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
            aria-label="Delete"
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
                removePin({ id });
              } else {
                addPin({ id });
              }
            }}
          >
            {isPinned ? (
              <PushPinSlashIcon className="text-muted-foreground" />
            ) : (
              <PushPinIcon className="text-muted-foreground" />
            )}
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
          <TaskProjectMenuItem
            currentProjectId={projectId}
            menuComponents={dropdownMenuComponents}
            taskId={id}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
