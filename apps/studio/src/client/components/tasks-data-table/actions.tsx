import type { TaskId } from "@instrument-org/workspace/client";

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
  StarIcon,
  StopCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";

export function TaskActionsCell({
  id,
  onDelete,
  onOpenInNewTab,
  onSettings,
  onStop,
}: {
  id: TaskId;
  onDelete: (id: TaskId) => void;
  onOpenInNewTab: (id: TaskId) => void;
  onSettings: (id: TaskId) => void;
  onStop: (id: TaskId) => void;
}) {
  const { data: taskAgentStatus } = useTaskAgentStatus({ id });
  const sessionActors = taskAgentStatus?.sessionActors ?? [];
  const isRunning = sessionActors.some((actor) =>
    actor.tags.includes("agent.alive"),
  );

  const { data: favoriteTaskIds } = useQuery(
    rpcClient.favorites.live.listTaskIds.experimental_liveOptions(),
  );
  const isFavorite = favoriteTaskIds?.includes(id);

  const { mutateAsync: removeFavorite } = useMutation(
    rpcClient.favorites.remove.mutationOptions(),
  );

  const { mutateAsync: addFavorite } = useMutation(
    rpcClient.favorites.add.mutationOptions(),
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
              if (isFavorite) {
                void removeFavorite({ id });
              } else {
                void addFavorite({ id });
              }
            }}
          >
            <StarIcon
              className="text-muted-foreground"
              weight={isFavorite ? "fill" : undefined}
            />
            <span>{isFavorite ? "Remove favorite" : "Favorite"}</span>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
