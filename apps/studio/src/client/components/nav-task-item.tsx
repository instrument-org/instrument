import { openDeleteTask } from "@/client/atoms/delete-task-modal";
import { InternalLink } from "@/client/components/internal-link";
import { TaskMenuItems } from "@/client/components/task-menu-items";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import {
  markTitleRenamedByUser,
  useTitleArrival,
} from "@/client/hooks/use-title-arrival";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { useMutation } from "@tanstack/react-query";
import { memo, useState } from "react";
import { toast } from "sonner";

import { InlineRenameInput } from "./inline-rename-input";
import { TaskStatusIcon } from "./session-status-icon";
import { UnreadDot } from "./unread-dot";

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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const menuOpen = dropdownOpen || contextOpen;
  const isUnread = Boolean(task.unreadIndicator);

  const { mutateAsync: renameTask } = useMutation(
    rpcClient.workspace.task.update.mutationOptions(),
  );

  const rename = useInlineRename({
    onSave: async (next) => {
      markTitleRenamedByUser(task.id, next);
      await renameTask({ id: task.id, name: next });
    },
    value: task.title,
  });

  const titleArrival = useTitleArrival(task.id, task.title);

  const { mutate: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions({
      onError: (error) => {
        toast.error("Failed to pin task", { description: error.message });
      },
    }),
  );
  const { mutate: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions({
      onError: (error) => {
        toast.error("Failed to unpin task", { description: error.message });
      },
    }),
  );

  const handleTogglePin = () => {
    if (isPinned) {
      removePin({ id: task.id });
    } else {
      addPin({ id: task.id });
    }
  };

  const renderMenuItems = (menuComponents: MenuComponents) => (
    <TaskMenuItems
      isPinned={isPinned}
      menuComponents={menuComponents}
      onDelete={() => {
        openDeleteTask(task);
      }}
      onOpenInNewTab={() => {
        onOpenInNewTab(task.id);
      }}
      onRename={rename.start}
      onTogglePin={handleTogglePin}
      task={task}
    />
  );

  return (
    <SidebarMenuItem
      className="group [&:has([data-task-status]>*)_[data-sidebar=menu-button]]:pr-8"
      key={task.id}
    >
      {rename.isEditing ? (
        <InlineRenameInput inputProps={rename.inputProps} />
      ) : (
        <>
          <ContextMenu onOpenChange={setContextOpen}>
            <ContextMenuTrigger asChild>
              <SidebarMenuButton
                asChild
                className="h-9 text-sidebar-foreground/60 group-hover:bg-sidebar-accent group-hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
                isActive={isActive}
              >
                <InternalLink
                  onDoubleClick={(e) => {
                    if (!isActive) {
                      return;
                    }
                    if (!(e.target as Element).closest("[data-task-title]")) {
                      return;
                    }
                    rename.start();
                  }}
                  openInCurrentTab
                  params={{ id: task.id }}
                  preload="intent"
                  to="/tasks/$id"
                >
                  {isPinned && (
                    <PushPinIcon className="size-4 shrink-0 text-gray-400 [[data-active=true]_&]:text-sidebar-foreground" />
                  )}
                  <span
                    className={cn("truncate", titleArrival.className)}
                    data-task-title
                    onAnimationEnd={titleArrival.onAnimationEnd}
                  >
                    {task.title}
                  </span>
                </InternalLink>
              </SidebarMenuButton>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">
              {renderMenuItems(contextMenuComponents)}
            </ContextMenuContent>
          </ContextMenu>

          {!menuOpen && (
            <div
              className="pointer-events-none absolute inset-y-0 right-1 flex w-5 items-center justify-center rounded-md group-hover:hidden"
              data-task-status
            >
              {isUnread ? (
                <UnreadDot />
              ) : (
                <TaskStatusIcon className="size-4 shrink-0" id={task.id} />
              )}
            </div>
          )}

          <DropdownMenu onOpenChange={setDropdownOpen} open={dropdownOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction showOnHover>
                <DotsThreeOutlineVerticalIcon weight="fill" />
                <span className="sr-only">More</span>
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" side="bottom">
              {renderMenuItems(dropdownMenuComponents)}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </SidebarMenuItem>
  );
});
