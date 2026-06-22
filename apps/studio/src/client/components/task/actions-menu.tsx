import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
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
import { toast } from "sonner";

import { TaskOpenInSubmenu } from "./open-in-submenu";

export function TaskActionsMenu({
  id,
  onDebugClick,
  onReplayClick,
  onSettingsClick,
  selectedSessionId,
}: {
  id: TaskId;
  onDebugClick: () => void;
  onReplayClick: () => void;
  onSettingsClick: () => void;
  selectedSessionId?: StoreId.Session;
}) {
  const navigate = useNavigate();
  const isDeveloperMode = useDeveloperMode();

  const { data: favoriteTaskIds } = useQuery(
    rpcClient.favorites.live.listTaskIds.experimental_liveOptions(),
  );
  const isFavorite = favoriteTaskIds?.includes(id) ?? false;

  const { mutateAsync: removeFavorite } = useMutation(
    rpcClient.favorites.remove.mutationOptions(),
  );

  const { mutateAsync: addFavorite } = useMutation(
    rpcClient.favorites.add.mutationOptions(),
  );

  const copyFolderPathMutation = useMutation(
    rpcClient.utils.copyTaskPathToClipboard.mutationOptions({
      onError: (error) => {
        toast.error("Failed to copy folder path", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast.success("Folder path copied to clipboard");
      },
    }),
  );

  const handleDebugChat = () => {
    if (!selectedSessionId) {
      return;
    }
    onDebugClick();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={toolbarClassName({
            className:
              "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            pressed: false,
          })}
          size="icon-sm"
          variant="ghost"
        >
          <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
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
          onClick={() => {
            void navigate({
              from: "/tasks/$id",
              params: { id },
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
              className="text-dev-700 dark:text-dev-300"
              disabled={!selectedSessionId}
              onClick={handleDebugChat}
            >
              <BugIcon className="size-4 text-dev-700 dark:text-dev-300" />
              Debug chat
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-dev-700 dark:text-dev-300"
              disabled={!selectedSessionId}
              onClick={() => {
                if (selectedSessionId) {
                  onReplayClick();
                }
              }}
            >
              <ArrowCounterClockwiseIcon className="size-4 text-dev-700 dark:text-dev-300" />
              Replay chat
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-dev-700 dark:text-dev-300"
              onClick={() => {
                void copyFolderPathMutation.mutateAsync({ id });
              }}
            >
              <CopyIcon className="size-4 text-dev-700 dark:text-dev-300" />
              Copy folder path
            </DropdownMenuItem>
            <TaskOpenInSubmenu id={id} />
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            void navigate({
              from: "/tasks/$id",
              params: { id },
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
