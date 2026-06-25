import { InternalLink } from "@/client/components/internal-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { openCreateProject } from "@/client/lib/project-overlays";
import { rpcClient } from "@/client/rpc/client";
import { type Task, type TaskId } from "@instrument-org/workspace/client";
import {
  ArrowUpRightIcon,
  BagIcon,
  CaretLeftIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  PushPinIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { memo, useState } from "react";

import { InlineRenameInput } from "./inline-rename-input";
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
  // The sidebar lives in its own WebContentsView, so a flyout submenu for
  // "Add to project" would be clipped. Instead the menu drills in: swap the
  // popover contents to the project list (vertical, stays in bounds).
  const [menuView, setMenuView] = useState<"projects" | "root">("root");

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

  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );
  const { mutateAsync: addTaskToProject } = useMutation(
    rpcClient.workspace.project.addTask.mutationOptions(),
  );
  const { mutateAsync: removeTaskFromProject } = useMutation(
    rpcClient.workspace.project.removeTask.mutationOptions(),
  );

  const handleTogglePin = async () => {
    await (isPinned ? removePin({ id: task.id }) : addPin({ id: task.id }));
  };

  return (
    <SidebarMenuItem className="group" key={task.id}>
      {rename.isEditing ? (
        <InlineRenameInput inputProps={rename.inputProps} />
      ) : (
        <DropdownMenu
          onOpenChange={(open) => {
            setIsMenuOpen(open);
            if (!open) {
              setMenuView("root");
            }
          }}
          open={isMenuOpen}
        >
          <SidebarMenuButton
            asChild
            className="h-9 text-sidebar-foreground/60 group-hover:bg-sidebar-accent group-hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
            isActive={isActive}
            onContextMenu={(e) => {
              e.preventDefault();
              setIsMenuOpen(true);
            }}
          >
            <InternalLink
              onDoubleClick={rename.start}
              openInCurrentTab
              params={{ id: task.id }}
              to="/tasks/$id"
            >
              {isPinned && (
                <PushPinIcon className="!size-3.5 shrink-0 text-gray-400 [[data-active=true]_&]:text-sidebar-foreground" />
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

          <DropdownMenuContent align="end" className="w-52" side="bottom">
            {menuView === "projects" ? (
              <>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setMenuView("root");
                  }}
                >
                  <CaretLeftIcon className="text-muted-foreground" />
                  <span>Back</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {projects
                  ?.filter((project) => project.id !== task.projectId)
                  .map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onSelect={() => {
                        void addTaskToProject({
                          projectId: project.id,
                          taskId: task.id,
                        });
                      }}
                    >
                      <BagIcon className="text-muted-foreground" />
                      <span className="truncate">{project.name}</span>
                    </DropdownMenuItem>
                  ))}
                {projects?.some((project) => project.id !== task.projectId) && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    openCreateProject(task.id);
                  }}
                >
                  <PlusIcon className="text-muted-foreground" />
                  <span>New project</span>
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    void handleTogglePin();
                  }}
                >
                  <PushPinIcon className="text-muted-foreground" />
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
                <DropdownMenuItem onClick={rename.start}>
                  <PencilSimpleLineIcon className="text-muted-foreground" />
                  <span>Rename</span>
                </DropdownMenuItem>
                {task.projectId ? (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setMenuView("projects");
                      }}
                    >
                      <BagIcon className="text-muted-foreground" />
                      <span>Move to project</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        void removeTaskFromProject({ taskId: task.id });
                      }}
                    >
                      <XCircleIcon className="text-muted-foreground" />
                      <span>Remove from project</span>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setMenuView("projects");
                    }}
                  >
                    <BagIcon className="text-muted-foreground" />
                    <span>Add to project</span>
                  </DropdownMenuItem>
                )}
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
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
});
