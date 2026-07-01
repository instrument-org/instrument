import { TaskDevDiskMenuItems } from "@/client/components/dev-disk-menu-items";
import { InternalLink } from "@/client/components/internal-link";
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
import { memo, useState } from "react";

import { InlineRenameInput } from "./inline-rename-input";
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const menuOpen = dropdownOpen || contextOpen;

  const { mutateAsync: renameTask } = useMutation(
    rpcClient.workspace.task.update.mutationOptions(),
  );

  const rename = useInlineRename({
    onSave: async (next) => {
      await renameTask({ id: task.id, name: next });
    },
    value: task.title,
  });

  const { mutateAsync: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions(),
  );
  const { mutateAsync: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions(),
  );

  const handleTogglePin = async () => {
    await (isPinned ? removePin({ id: task.id }) : addPin({ id: task.id }));
  };

  const renderMenuItems = (menuComponents: MenuComponents) => {
    const { Item, Separator } = menuComponents;
    return (
      <>
        <Item
          onClick={() => {
            void handleTogglePin();
          }}
        >
          <PushPinIcon className="text-muted-foreground" />
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </Item>
        <InternalLink
          openInCurrentTab
          params={{ id: task.id }}
          search={{ showDuplicate: true }}
          to="/tasks/$id"
        >
          <Item>
            <CopyIcon className="text-muted-foreground" />
            <span>Duplicate</span>
          </Item>
        </InternalLink>
        <Item onClick={rename.start}>
          <PencilSimpleLineIcon className="text-muted-foreground" />
          <span>Rename</span>
        </Item>
        <TaskProjectMenuItem
          currentProjectId={task.projectId}
          menuComponents={menuComponents}
          taskId={task.id}
        />
        <Separator />
        <Item
          onClick={() => {
            onOpenInNewTab(task.id);
          }}
        >
          <ArrowUpRightIcon className="text-muted-foreground" />
          <span>Open in new tab</span>
        </Item>
        <TaskDevDiskMenuItems
          menuComponents={menuComponents}
          taskId={task.id}
        />
        <Separator />
        <InternalLink
          openInCurrentTab
          params={{ id: task.id }}
          search={{ showDelete: true }}
          to="/tasks/$id"
        >
          <Item variant="destructive">
            <TrashIcon className="size-4" />
            <span>Delete</span>
          </Item>
        </InternalLink>
      </>
    );
  };

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
                  to="/tasks/$id"
                >
                  {isPinned && (
                    <PushPinIcon className="size-4 shrink-0 text-gray-400 [[data-active=true]_&]:text-sidebar-foreground" />
                  )}
                  <span className="truncate" data-task-title>
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
              className="pointer-events-none absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md group-hover:hidden"
              data-task-status
            >
              <TaskStatusIcon className="mt-1 size-4 shrink-0" id={task.id} />
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
