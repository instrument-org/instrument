import { InternalLink } from "@/client/components/internal-link";
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
  PushPinIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { memo, useEffect, useRef, useState } from "react";

import { TaskProjectMenuItem } from "./project/task-project-menu-item";
import { TaskStatusIcon } from "./session-status-icon";

interface NavTaskItemProps {
  isActive: boolean;
  isPinned: boolean;
  onOpenInNewTab: (id: TaskId) => void;
  task: Task;
}

export const NavTaskItem = memo(function NavTaskItem({
  isActive,
  isPinned,
  onOpenInNewTab,
  task,
}: NavTaskItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const { isPending: isRenameLoading, mutateAsync: renameTask } = useMutation(
    rpcClient.workspace.task.update.mutationOptions(),
  );

  const { mutateAsync: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions(),
  );
  const { mutateAsync: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions(),
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

  const handleTogglePin = async () => {
    await (isPinned ? removePin({ id: task.id }) : addPin({ id: task.id }));
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
              {isPinned && (
                <PushPinIcon
                  className="size-3.5 shrink-0 text-sidebar-foreground/40"
                  weight="fill"
                />
              )}
              <span className="truncate">{task.title}</span>
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
            <DropdownMenuItem
              onClick={() => {
                void handleTogglePin();
              }}
            >
              <PushPinIcon
                className="text-muted-foreground"
                weight={isPinned ? "fill" : undefined}
              />
              <span>{isPinned ? "Unpin" : "Pin"}</span>
            </DropdownMenuItem>
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
            <TaskProjectMenuItem taskId={task.id} />
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
