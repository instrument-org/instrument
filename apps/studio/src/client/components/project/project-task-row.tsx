import { InlineRenameInput } from "@/client/components/inline-rename-input";
import { InternalLink } from "@/client/components/internal-link";
import { RelativeTime } from "@/client/components/relative-time";
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
import { UnreadDot } from "@/client/components/unread-dot";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { markTitleRenamedByUser } from "@/client/hooks/use-title-arrival";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export function ProjectTaskRow({
  isPinned,
  onDelete,
  onOpenInNewTab,
  task,
}: {
  isPinned: boolean;
  onDelete: (task: Task) => void;
  onOpenInNewTab: (task: Task) => void;
  task: Task;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
  if (rename.isEditing) {
    return <InlineRenameInput inputProps={rename.inputProps} />;
  }

  const renderMenuItems = (menuComponents: MenuComponents) => (
    <TaskMenuItems
      isPinned={isPinned}
      menuComponents={menuComponents}
      onDelete={() => {
        onDelete(task);
      }}
      onOpenInNewTab={() => {
        onOpenInNewTab(task);
      }}
      onRename={rename.start}
      onTogglePin={() => {
        if (isPinned) {
          removePin({ id: task.id });
        } else {
          addPin({ id: task.id });
        }
      }}
      task={task}
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex h-9 items-center gap-x-2 rounded-md px-3">
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
            {/* With the meta, not in the status slot on the left: that slot is
                empty on an idle task, so a dot there would indent an unread
                row's title past every read row beside it. */}
            {isUnread && <UnreadDot />}
            <RelativeTime
              className="text-xs text-muted-foreground"
              date={task.updatedAt}
              tooltip={false}
            />
            <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
              <DropdownMenuTrigger
                className={cn(
                  "flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
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
