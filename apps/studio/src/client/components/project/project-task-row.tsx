import { InlineRenameInput } from "@/client/components/inline-rename-input";
import { InternalLink } from "@/client/components/internal-link";
import { TaskStatusIcon } from "@/client/components/session-status-icon";
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
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import {
  DotsThreeOutlineVerticalIcon,
  PushPinIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

export function ProjectTaskRow({
  isPinned,
  onDelete,
  task,
}: {
  isPinned: boolean;
  onDelete: (task: Task) => void;
  task: Task;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const { mutateAsync: renameTask } = useMutation(
    rpcClient.workspace.task.update.mutationOptions(),
  );
  const rename = useInlineRename({
    onSave: async (next) => {
      await renameTask({ id: task.id, name: next });
    },
    value: task.title,
  });

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
  const { mutate: removeFromProject } = useMutation(
    rpcClient.workspace.project.removeTask.mutationOptions({
      onError: (error) => {
        toast.error("Failed to remove task from project", {
          description: error.message,
        });
      },
    }),
  );

  if (rename.isEditing) {
    return <InlineRenameInput inputProps={rename.inputProps} />;
  }

  const renderMenuItems = (menuComponents: MenuComponents) => {
    const { Item } = menuComponents;
    return (
      <TaskMenuItems
        extras={
          <Item
            onSelect={() => {
              removeFromProject({ taskId: task.id });
            }}
          >
            <XCircleIcon className="text-muted-foreground" />
            <span>Remove from project</span>
          </Item>
        }
        isPinned={isPinned}
        menuComponents={menuComponents}
        onDelete={() => {
          onDelete(task);
        }}
        onRename={rename.start}
        onTogglePin={() => {
          if (isPinned) {
            removePin({ id: task.id });
          } else {
            addPin({ id: task.id });
          }
        }}
      />
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex h-9 items-center gap-x-2 rounded-md pr-3">
          {isPinned && (
            <PushPinIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
          )}
          <TaskStatusIcon className="size-3.5 shrink-0" id={task.id} />
          <InternalLink
            className="min-w-0 flex-1 truncate rounded-sm text-sm text-muted-foreground outline-none group-hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]"
            openInCurrentTab
            params={{ id: task.id }}
            preload="intent"
            to="/tasks/$id"
          >
            {task.title}
          </InternalLink>
          <div className="group/meta -mr-6 flex shrink-0 items-center gap-x-1">
            <span className="text-xs text-muted-foreground">
              {formatUpdated(task.updatedAt)}
            </span>
            <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
              <DropdownMenuTrigger
                className={cn(
                  "flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors outline-none group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
                  menuOpen && "bg-accent text-foreground opacity-100",
                )}
              >
                <DotsThreeOutlineVerticalIcon
                  className="size-4"
                  weight="fill"
                />
                <span className="sr-only">More</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {renderMenuItems(dropdownMenuComponents)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenuItems(contextMenuComponents)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function formatUpdated(date: Date) {
  const diff = Date.now() - date.getTime();
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return formatDistanceToNow(date, { addSuffix: true })
      .replace("less than ", "")
      .replace("about ", "");
  }
  return format(date, "MMM d");
}
