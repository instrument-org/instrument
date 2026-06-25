import { InternalLink } from "@/client/components/internal-link";
import { TaskStatusIcon } from "@/client/components/session-status-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import {
  BagIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  PushPinIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";

export function ProjectTaskRow({
  isPinned,
  onDelete,
  onRename,
  task,
}: {
  isPinned: boolean;
  onDelete: (task: Task) => void;
  onRename: (task: Task) => void;
  task: Task;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { mutateAsync: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions(),
  );
  const { mutateAsync: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions(),
  );
  const { mutateAsync: removeFromProject } = useMutation(
    rpcClient.workspace.project.removeTask.mutationOptions(),
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex h-9 items-center gap-x-2 rounded-md px-3">
          {isPinned && (
            <PushPinIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
          )}
          <InternalLink
            className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-hover:text-foreground"
            openInCurrentTab
            params={{ id: task.id }}
            to="/tasks/$id"
          >
            {task.title}
          </InternalLink>
          <TaskStatusIcon className="size-4 shrink-0" id={task.id} />
          <div className="relative flex h-5 shrink-0 items-center justify-end">
            <span
              className={cn(
                "text-xs text-muted-foreground group-hover:opacity-0",
                menuOpen && "opacity-0",
              )}
            >
              {formatUpdated(task.updatedAt)}
            </span>
            <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
              <DropdownMenuTrigger
                className={cn(
                  "absolute right-0 flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:bg-accent hover:text-foreground",
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
                <DropdownMenuItem
                  onSelect={() => {
                    void (isPinned
                      ? removePin({ id: task.id })
                      : addPin({ id: task.id }));
                  }}
                >
                  <PushPinIcon className="text-muted-foreground" />
                  <span>{isPinned ? "Unpin" : "Pin"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void navigate({
                      params: { id: task.id },
                      search: { showDuplicate: true },
                      to: "/tasks/$id",
                    });
                  }}
                >
                  <CopyIcon className="text-muted-foreground" />
                  <span>Duplicate</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    onRename(task);
                  }}
                >
                  <PencilSimpleLineIcon className="text-muted-foreground" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void removeFromProject({ taskId: task.id });
                  }}
                >
                  <BagIcon className="text-muted-foreground" />
                  <span>Remove from project</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    onDelete(task);
                  }}
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            void (isPinned
              ? removePin({ id: task.id })
              : addPin({ id: task.id }));
          }}
        >
          <PushPinIcon className="text-muted-foreground" />
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            void navigate({
              params: { id: task.id },
              search: { showDuplicate: true },
              to: "/tasks/$id",
            });
          }}
        >
          <CopyIcon className="text-muted-foreground" />
          <span>Duplicate</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            onRename(task);
          }}
        >
          <PencilSimpleLineIcon className="text-muted-foreground" />
          <span>Rename</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            void removeFromProject({ taskId: task.id });
          }}
        >
          <BagIcon className="text-muted-foreground" />
          <span>Remove from project</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            onDelete(task);
          }}
          variant="destructive"
        >
          <TrashIcon className="size-4" />
          <span>Delete</span>
        </ContextMenuItem>
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
