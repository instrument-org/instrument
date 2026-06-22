import { InternalLink } from "@/client/components/internal-link";
import { TaskIcon } from "@/client/components/task-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { rpcClient } from "@/client/rpc/client";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import {
  ArrowUpRightIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  StarIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { memo, useEffect, useRef, useState } from "react";

import { TaskStatusIcon } from "./session-status-icon";

interface NavTaskItemProps {
  isActive: boolean;
  isFavorited: boolean;
  isFavorites: boolean;
  onOpenInNewTab: (id: TaskId) => void;
  onRemoveFavorite?: (id: TaskId) => void;
  task: Task;
}

export const NavTaskItem = memo(function NavTaskItem({
  isActive,
  isFavorited,
  isFavorites,
  onOpenInNewTab,
  onRemoveFavorite,
  task,
}: NavTaskItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const { isPending: isRenameLoading, mutateAsync: renameTask } = useMutation(
    rpcClient.workspace.task.update.mutationOptions(),
  );

  const { mutateAsync: addFavorite } = useMutation(
    rpcClient.favorites.add.mutationOptions(),
  );

  if (!isEditing && editValue !== task.title) {
    setEditValue(task.title);
  }

  const handleStartEdit = () => {
    setEditValue(task.title);
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(task.title);
  };

  const handleSaveEdit = async () => {
    if (!editValue.trim()) {
      return;
    }

    if (editValue.trim() === task.title) {
      setIsEditing(false);
      return;
    }

    try {
      await renameTask({
        id: task.id,
        name: editValue.trim(),
      });
      // wait for client update to avoid flicker
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      setIsEditing(false);
    } catch {
      setEditValue(task.title);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSaveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleAddFavorite = async () => {
    await addFavorite({ id: task.id });
  };

  return (
    <SidebarMenuItem className="group" key={task.id}>
      {isEditing ? (
        <div className="flex h-9 items-center gap-2 px-2">
          <Input
            className="-ml-1 h-7 pl-1 text-sm"
            disabled={isRenameLoading}
            onBlur={() => {
              void handleSaveEdit();
            }}
            onChange={(e) => {
              setEditValue(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            ref={inputRef}
            value={editValue}
          />
        </div>
      ) : (
        <DropdownMenu onOpenChange={setIsMenuOpen} open={isMenuOpen}>
          <SidebarMenuButton
            asChild
            className="h-9 gap-1 text-sidebar-foreground/60 group-hover:bg-sidebar-accent group-hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
            isActive={isActive}
            onContextMenu={(e) => {
              e.preventDefault();
              setIsMenuOpen(true);
            }}
          >
            <InternalLink
              onDoubleClick={handleStartEdit}
              openInCurrentTab
              params={{ id: task.id }}
              to="/tasks/$id"
            >
              <TaskIcon name={task.iconName} size="xs" />
              <span>{task.title}</span>
            </InternalLink>
          </SidebarMenuButton>

          {!isMenuOpen && (
            <div className="pointer-events-none absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md group-hover:hidden">
              <TaskStatusIcon className="mt-1 size-4 shrink-0" id={task.id} />
            </div>
          )}

          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover>
              <DotsThreeOutlineVerticalIcon weight="fill" />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-50" side="bottom">
            {(isFavorites || !isFavorited) && (
              <DropdownMenuItem
                onClick={() => {
                  if (isFavorites && onRemoveFavorite) {
                    onRemoveFavorite(task.id);
                  } else {
                    void handleAddFavorite();
                  }
                }}
              >
                <StarIcon
                  className="text-muted-foreground"
                  weight={isFavorites ? "fill" : undefined}
                />
                <span>{isFavorites ? "Remove favorite" : "Favorite"}</span>
              </DropdownMenuItem>
            )}
            <InternalLink
              openInCurrentTab
              params={{ id: task.id }}
              search={{ showDuplicate: true }}
              to="/tasks/$id"
            >
              <DropdownMenuItem>
                <CopyIcon className="text-muted-foreground" />
                <span>Duplicate</span>
              </DropdownMenuItem>
            </InternalLink>
            <DropdownMenuItem onClick={handleStartEdit}>
              <PencilSimpleLineIcon className="text-muted-foreground" />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                onOpenInNewTab(task.id);
              }}
            >
              <ArrowUpRightIcon className="text-muted-foreground" />
              <span>Open in new tab</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <InternalLink
              openInCurrentTab
              params={{ id: task.id }}
              search={{ showDelete: true }}
              to="/tasks/$id"
            >
              <DropdownMenuItem variant="destructive">
                <TrashIcon className="size-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </InternalLink>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
});
