import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import {
  type ProjectSubdomain,
  type StoreId,
} from "@instrument-org/workspace/client";
import {
  ArrowCounterClockwiseIcon,
  BugIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  StarIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { ProjectOpenInSubmenu } from "./open-in-submenu";

export function ProjectActionsMenu({
  onDebugClick,
  onReplayClick,
  onSettingsClick,
  selectedSessionId,
  subdomain,
}: {
  onDebugClick: () => void;
  onReplayClick: () => void;
  onSettingsClick: () => void;
  selectedSessionId?: StoreId.Session;
  subdomain: ProjectSubdomain;
}) {
  const navigate = useNavigate();
  const isDeveloperMode = useDeveloperMode();

  const { data: favoriteSubdomains } = useQuery(
    rpcClient.favorites.live.listSubdomains.experimental_liveOptions(),
  );
  const isFavorite = favoriteSubdomains?.includes(subdomain) ?? false;

  const { mutateAsync: removeFavorite } = useMutation(
    rpcClient.favorites.remove.mutationOptions(),
  );

  const { mutateAsync: addFavorite } = useMutation(
    rpcClient.favorites.add.mutationOptions(),
  );

  const handleDebugChat = () => {
    if (!selectedSessionId) {
      return;
    }
    onDebugClick();
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost">
              <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Project actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="bottom">
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
          onClick={() => {
            void navigate({
              from: "/projects/$subdomain",
              params: { subdomain },
              search: (prev) => ({ ...prev, showDuplicate: true }),
            });
          }}
        >
          <CopyIcon className="size-4" />
          <span>Duplicate</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSettingsClick}>
          <PencilSimpleLineIcon className="size-4" />
          <span>Rename</span>
        </DropdownMenuItem>

        {isDeveloperMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-blue-700 dark:text-blue-300"
              disabled={!selectedSessionId}
              onClick={handleDebugChat}
            >
              <BugIcon className="size-4 text-blue-700 dark:text-blue-300" />
              Debug chat
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-blue-700 dark:text-blue-300"
              disabled={!selectedSessionId}
              onClick={() => {
                if (selectedSessionId) {
                  onReplayClick();
                }
              }}
            >
              <ArrowCounterClockwiseIcon className="size-4 text-blue-700 dark:text-blue-300" />
              Replay chat
            </DropdownMenuItem>
            <ProjectOpenInSubmenu subdomain={subdomain} />
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            void navigate({
              from: "/projects/$subdomain",
              params: { subdomain },
              search: (prev) => ({ ...prev, showDelete: true }),
            });
          }}
          variant="destructive"
        >
          <TrashIcon />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
