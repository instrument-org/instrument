import type { ProjectSubdomain } from "@instrument-org/workspace/client";

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
import { useAppState } from "@/client/hooks/use-app-state";
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

export function ProjectActionsCell({
  onDelete,
  onOpenInNewTab,
  onSettings,
  onStop,
  subdomain,
}: {
  onDelete: (subdomain: ProjectSubdomain) => void;
  onOpenInNewTab: (subdomain: ProjectSubdomain) => void;
  onSettings: (subdomain: ProjectSubdomain) => void;
  onStop: (subdomain: ProjectSubdomain) => void;
  subdomain: ProjectSubdomain;
}) {
  const { data: appState } = useAppState({ subdomain });
  const sessionActors = appState?.sessionActors ?? [];
  const isRunning = sessionActors.some((actor) =>
    actor.tags.includes("agent.alive"),
  );

  const { data: favoriteSubdomains } = useQuery(
    rpcClient.favorites.live.listSubdomains.experimental_liveOptions(),
  );
  const isFavorite = favoriteSubdomains?.includes(subdomain);

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
                onStop(subdomain);
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
              onDelete(subdomain);
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
            onClick={(e) => {
              e.preventDefault();
              if (isFavorite) {
                void removeFavorite({ subdomain });
              } else {
                void addFavorite({ subdomain });
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
            onClick={(e) => {
              e.preventDefault();
              onSettings(subdomain);
            }}
          >
            <PencilSimpleLineIcon className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              onOpenInNewTab(subdomain);
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
