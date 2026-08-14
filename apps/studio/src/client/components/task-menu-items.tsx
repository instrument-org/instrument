import { TaskDevDiskMenuItems } from "@/client/components/dev-disk-menu-items";
import { TaskProjectMenuItem } from "@/client/components/project/task-project-menu-item";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { NotificationIcon } from "@phosphor-icons/react/Notification";
import { PencilSimpleLineIcon } from "@phosphor-icons/react/PencilSimpleLine";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * A task's action menu wherever the task is a row in a list -- the sidebar and a
 * project's task list -- rendered under both a dropdown (the "..." button) and a
 * context menu (right click) via {@link MenuComponents}. Every item uses
 * `onSelect` so keyboard and pointer activation behave the same.
 *
 * The task's own page builds its menu from `TaskActionsMenuItems` instead: it
 * carries actions that need the open session (transcripts, replay) and cannot
 * offer the ones that only mean something from somewhere else (opening the task
 * in a new tab).
 */
export function TaskMenuItems({
  isPinned,
  menuComponents,
  onDelete,
  onOpenInNewTab,
  onRename,
  onTogglePin,
  task,
}: {
  isPinned: boolean;
  menuComponents: MenuComponents;
  onDelete: () => void;
  onOpenInNewTab: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  task: Task;
}) {
  const { Item, Separator } = menuComponents;
  const isUnread = Boolean(task.unreadIndicator);

  const { mutate: markUnread } = useMutation(
    rpcClient.workspace.task.markUnread.mutationOptions({
      onError: (error) => {
        toast.error("Failed to mark task as unread", {
          description: error.message,
        });
      },
    }),
  );

  const { mutate: markRead } = useMutation(
    rpcClient.workspace.task.clearIndicator.mutationOptions({
      onError: (error) => {
        toast.error("Failed to mark task as read", {
          description: error.message,
        });
      },
    }),
  );

  return (
    <>
      <Item onSelect={onTogglePin}>
        {isPinned ? (
          <PushPinSlashIcon className="text-muted-foreground" />
        ) : (
          <PushPinIcon className="text-muted-foreground" />
        )}
        <span>{isPinned ? "Unpin" : "Pin"}</span>
      </Item>
      <Item onSelect={onRename}>
        <PencilSimpleLineIcon className="text-muted-foreground" />
        <span>Rename</span>
      </Item>
      <Item
        onSelect={() => {
          if (isUnread) {
            markRead({ id: task.id });
          } else {
            markUnread({ id: task.id });
          }
        }}
      >
        <NotificationIcon className="text-muted-foreground" />
        <span>{isUnread ? "Mark as read" : "Mark as unread"}</span>
      </Item>
      <TaskProjectMenuItem
        currentProjectId={task.projectId}
        menuComponents={menuComponents}
        taskId={task.id}
      />
      <Separator />
      <Item onSelect={onOpenInNewTab}>
        <ArrowUpRightIcon className="text-muted-foreground" />
        <span>Open in new tab</span>
      </Item>
      <TaskDevDiskMenuItems menuComponents={menuComponents} taskId={task.id} />
      <Separator />
      <Item onSelect={onDelete} variant="destructive">
        <TrashIcon className="size-4" />
        <span>Delete</span>
      </Item>
    </>
  );
}
