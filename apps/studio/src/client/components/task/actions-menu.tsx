import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import {
  type ProjectId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  ArrowCounterClockwiseIcon,
  ArrowLineDownIcon,
  ArticleIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  FileArchiveIcon,
  PencilSimpleLineIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { TaskProjectMenuItem } from "../project/task-project-menu-item";
import {
  dropdownMenuComponents,
  type MenuComponents,
} from "../ui/menu-components";
import { TaskOpenInSubmenu } from "./open-in-submenu";
import { useTranscriptActions } from "./transcript-actions";

export function TaskActionsMenu({
  renderMenuItems,
}: {
  renderMenuItems: (menuComponents: MenuComponents) => ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={toolbarClassName({
            // 4px around a 16px glyph: the button hugs the title it acts on
            // rather than reading as its own toolbar slot.
            className:
              "size-6 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            pressed: false,
          })}
          size="icon-sm"
          variant="ghost"
        >
          <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        {renderMenuItems(dropdownMenuComponents)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The task's action items, authored once and rendered under both the overflow
// "..." dropdown and the header title's right-click context menu via
// {@link MenuComponents}.
export function TaskActionsMenuItems({
  id,
  menuComponents,
  onDelete,
  onExportZip,
  onRename,
  onReplayClick,
  onViewTranscript,
  projectId,
  selectedSessionId,
}: {
  id: TaskId;
  menuComponents: MenuComponents;
  onDelete: () => void;
  onExportZip: () => void;
  onRename: () => void;
  onReplayClick: () => void;
  onViewTranscript: () => void;
  projectId: null | ProjectId | undefined;
  selectedSessionId?: StoreId.Session;
}) {
  const { Item, Separator } = menuComponents;
  const isDeveloperMode = useDeveloperMode();

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions(),
  );
  const isPinned = pinnedTaskIds?.includes(id) ?? false;

  const { mutate: removePin } = useMutation(
    rpcClient.workspace.pin.remove.mutationOptions({
      onError: (error) => {
        toast.error("Failed to unpin task", { description: error.message });
      },
    }),
  );

  const { mutate: addPin } = useMutation(
    rpcClient.workspace.pin.add.mutationOptions({
      onError: (error) => {
        toast.error("Failed to pin task", { description: error.message });
      },
    }),
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

  const transcript = useTranscriptActions({ id, sessionId: selectedSessionId });

  return (
    <>
      <Item
        onSelect={() => {
          if (isPinned) {
            removePin({ id });
          } else {
            addPin({ id });
          }
        }}
      >
        {isPinned ? (
          <PushPinSlashIcon className="text-muted-foreground" />
        ) : (
          <PushPinIcon className="text-muted-foreground" />
        )}
        <span>{isPinned ? "Unpin" : "Pin"}</span>
      </Item>
      <Item onSelect={onRename}>
        <PencilSimpleLineIcon className="size-4" />
        <span>Rename</span>
      </Item>
      <TaskProjectMenuItem
        currentProjectId={projectId}
        menuComponents={menuComponents}
        taskId={id}
      />
      <Item onSelect={onExportZip}>
        <FileArchiveIcon className="size-4" />
        <span>Export as zip</span>
      </Item>

      {isDeveloperMode && (
        <>
          <Separator />
          {/* Copy and save come first and act without opening anything: the
              transcript is nearly always on its way to somewhere else. */}
          <Item
            className="text-dev-700 dark:text-dev-300"
            disabled={!selectedSessionId}
            onSelect={() => {
              transcript.copy("markdown");
            }}
          >
            <CopyIcon className="size-4 text-dev-700 dark:text-dev-300" />
            Copy transcript
          </Item>
          <Item
            className="text-dev-700 dark:text-dev-300"
            disabled={!selectedSessionId}
            onSelect={() => {
              transcript.save("markdown");
            }}
          >
            <ArrowLineDownIcon className="size-4 text-dev-700 dark:text-dev-300" />
            Save transcript
          </Item>
          <Item
            className="text-dev-700 dark:text-dev-300"
            disabled={!selectedSessionId}
            onSelect={onViewTranscript}
          >
            <ArticleIcon className="size-4 text-dev-700 dark:text-dev-300" />
            View transcript
          </Item>
          <Item
            className="text-dev-700 dark:text-dev-300"
            disabled={!selectedSessionId}
            onSelect={() => {
              if (selectedSessionId) {
                onReplayClick();
              }
            }}
          >
            <ArrowCounterClockwiseIcon className="size-4 text-dev-700 dark:text-dev-300" />
            Replay chat
          </Item>
          <Item
            className="text-dev-700 dark:text-dev-300"
            onSelect={() => {
              copyFolderPathMutation.mutate({ id });
            }}
          >
            <CopyIcon className="size-4 text-dev-700 dark:text-dev-300" />
            Copy folder path
          </Item>
          <TaskOpenInSubmenu id={id} menuComponents={menuComponents} />
        </>
      )}

      <Separator />

      <Item onSelect={onDelete} variant="destructive">
        <TrashIcon />
        <span>Delete</span>
      </Item>
    </>
  );
}
