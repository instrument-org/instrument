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
  type StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bug,
  Copy,
  MoreVertical,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  TrashIcon,
} from "lucide-react";

import { ProjectOpenInSubmenu } from "./open-in-submenu";

export function ProjectActionsMenu({
  onDebugClick,
  onReplayClick,
  onSettingsClick,
  project,
  selectedSessionId,
}: {
  onDebugClick: () => void;
  onReplayClick: () => void;
  onSettingsClick: () => void;
  project: WorkspaceAppProject;
  selectedSessionId?: StoreId.Session;
}) {
  const navigate = useNavigate();
  const isDeveloperMode = useDeveloperMode();

  const { data: favoriteSubdomains } = useQuery(
    rpcClient.favorites.live.listSubdomains.experimental_liveOptions(),
  );
  const isFavorite = favoriteSubdomains?.includes(project.subdomain) ?? false;

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
            <Button size="icon" variant="ghost">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Project actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuItem
          onClick={() => {
            void navigate({
              from: "/projects/$subdomain",
              params: { subdomain: project.subdomain },
              search: (prev) => ({ ...prev, showDuplicate: true }),
            });
          }}
        >
          <Copy className="size-4" />
          <span>Duplicate</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSettingsClick}>
          <Pencil className="size-4" />
          <span>Rename</span>
        </DropdownMenuItem>

        {isFavorite ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              void removeFavorite({ subdomain: project.subdomain });
            }}
          >
            <StarOff className="text-muted-foreground" />
            <span>Remove favorite</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              void addFavorite({ subdomain: project.subdomain });
            }}
          >
            <Star className="text-muted-foreground" />
            <span>Favorite</span>
          </DropdownMenuItem>
        )}

        {isDeveloperMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-warning-foreground"
              disabled={!selectedSessionId}
              onClick={handleDebugChat}
            >
              <Bug className="size-4 text-warning-foreground" />
              Debug chat
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-warning-foreground"
              disabled={!selectedSessionId}
              onClick={() => {
                if (selectedSessionId) {
                  onReplayClick();
                }
              }}
            >
              <RotateCcw className="size-4 text-warning-foreground" />
              Replay chat
            </DropdownMenuItem>
            <ProjectOpenInSubmenu project={project} />
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            void navigate({
              from: "/projects/$subdomain",
              params: { subdomain: project.subdomain },
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
