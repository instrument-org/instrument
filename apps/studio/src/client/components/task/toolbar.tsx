import { openDeleteTask } from "@/client/atoms/delete-task-modal";
import { ShareExport } from "@/client/components/icons/share-export";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { Button } from "@/client/components/ui/button";
import { Toggle, toolbarClassName } from "@/client/components/ui/toggle";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { FileArchiveIcon, FolderIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { ReplaySessionModal } from "../debug/replay-session-modal";
import { ExportZipModal } from "../export-zip-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { type MenuComponents } from "../ui/menu-components";
import { TaskActionsMenu, TaskActionsMenuItems } from "./actions-menu";
import { TaskDebugDialog } from "./debug-dialog";
import { TaskBreadcrumb } from "./task-breadcrumb";
import { TaskUsageSummary } from "./usage-summary";

export function TaskToolbar({
  onSidebarChange,
  selectedSessionId,
  sidebar,
  task,
}: {
  onSidebarChange: (sidebar: "chat" | "files") => void;
  selectedSessionId?: StoreId.Session;
  sidebar: "chat" | "files";
  task: Task;
}) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [exportZipModalOpen, setExportZipModalOpen] = useState(false);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);

  const isDeveloperMode = useDeveloperMode();

  // Inline rename is the quick path from double-clicking the title itself. The
  // menus (overflow and right-click) open the dialog instead: a menu item can
  // sit far from the title, and returning focus into an inline input from there
  // fights the trigger's own focus restore.
  const { mutateAsync: renameTask } = useMutation(
    rpcClient.workspace.task.update.mutationOptions(),
  );
  const rename = useInlineRename({
    onSave: async (next) => {
      await renameTask({ id: task.id, name: next });
    },
    value: task.title,
  });

  const renderMenuItems = (menuComponents: MenuComponents) => (
    <TaskActionsMenuItems
      id={task.id}
      menuComponents={menuComponents}
      onDebugClick={() => {
        setDebugDialogOpen(true);
      }}
      onDelete={() => {
        openDeleteTask(task);
      }}
      onRename={() => {
        setSettingsDialogOpen(true);
      }}
      onReplayClick={() => {
        setReplayModalOpen(true);
      }}
      projectId={task.projectId}
      selectedSessionId={selectedSessionId}
    />
  );

  return (
    <>
      <div className="@container w-full bg-background p-3">
        <div className="flex min-w-0 items-center gap-x-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 items-center gap-x-1 overflow-hidden">
            <TaskBreadcrumb
              onChatClick={() => {
                onSidebarChange("chat");
              }}
              rename={rename}
              renderMenuItems={renderMenuItems}
              sidebar={sidebar}
              task={task}
            />

            <Toggle
              aria-label="Show files"
              className="max-w-24 min-w-8 shrink overflow-hidden px-2"
              onPressedChange={() => {
                onSidebarChange("files");
              }}
              pressed={sidebar === "files"}
              size="sm"
              variant="toolbar"
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="hidden min-w-0 truncate @min-[380px]:inline">
                Files
              </span>
            </Toggle>
          </div>

          <div className="flex min-w-8 shrink items-center justify-end gap-x-2 overflow-hidden">
            {isDeveloperMode && (
              <div className="min-w-0 shrink overflow-hidden">
                <TaskUsageSummary
                  id={task.id}
                  onClick={() => {
                    setDebugDialogOpen(true);
                  }}
                />
              </div>
            )}
            <div className="flex min-w-8 items-center justify-end gap-x-2 overflow-hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className={toolbarClassName({
                      className:
                        "min-w-8 shrink overflow-hidden gap-2 px-2 has-[>svg]:px-2 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
                      pressed: false,
                    })}
                    size="sm"
                    variant="ghost"
                  >
                    <ShareExport className="size-4 shrink-0" />
                    <span className="hidden min-w-0 truncate @min-[380px]:inline">
                      Share
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setExportZipModalOpen(true);
                    }}
                  >
                    <FileArchiveIcon className="size-4" />
                    Export as zip
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="shrink-0">
                <TaskActionsMenu renderMenuItems={renderMenuItems} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <TaskSettingsDialog
        onOpenChange={setSettingsDialogOpen}
        open={settingsDialogOpen}
        task={task}
      />

      <ExportZipModal
        isOpen={exportZipModalOpen}
        onClose={() => {
          setExportZipModalOpen(false);
        }}
        task={task}
      />

      <TaskDebugDialog
        onOpenChange={setDebugDialogOpen}
        open={debugDialogOpen}
        selectedSessionId={selectedSessionId}
        task={task}
      />

      <ReplaySessionModal
        isOpen={replayModalOpen}
        onClose={() => {
          setReplayModalOpen(false);
        }}
        selectedSessionId={selectedSessionId}
        task={task}
      />
    </>
  );
}
