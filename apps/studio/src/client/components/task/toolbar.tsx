import { openDeleteTask } from "@/client/atoms/delete-task-modal";
import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { useTaskPane } from "@/client/hooks/use-task-pane";
import { hasVisibleTaskFiles } from "@/client/lib/task-file-groups";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { FoldersIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { ReplaySessionModal } from "../debug/replay-session-modal";
import { ExportZipModal } from "../export-zip-modal";
import { type MenuComponents } from "../ui/menu-components";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { TaskActionsMenu, TaskActionsMenuItems } from "./actions-menu";
import { TaskDebugDialog } from "./debug-dialog";
import { PaneToggle } from "./pane-toggle";
import { TaskBreadcrumb } from "./task-breadcrumb";
import { TaskFiles } from "./task-files";
import { TaskUsageSummary } from "./usage-summary";

export function TaskToolbar({
  activeFilePath,
  attachedFolders,
  files,
  onFileSelect,
  selectedSessionId,
  task,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  onFileSelect: (file: TaskFileViewerFile) => void;
  selectedSessionId?: StoreId.Session;
  task: Task;
}) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [exportZipModalOpen, setExportZipModalOpen] = useState(false);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);

  const isDeveloperMode = useDeveloperMode();
  const pane = useTaskPane(task.id);

  // The trigger is the only way into this list, so it comes and goes with the
  // list: a task with nothing to browse gets no button rather than a button
  // onto "There are no files yet."
  const hasFilesToBrowse =
    hasVisibleTaskFiles(files) ||
    (attachedFolders ? Object.keys(attachedFolders).length > 0 : false);

  // Inline rename is the quick path from clicking the title itself. The
  // menus open the dialog instead: swapping the title for an input as a menu
  // closes drops the focus that was meant to land in it, and resizes the header
  // out from under the click that asked for the rename.
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
      onExportZip={() => {
        setExportZipModalOpen(true);
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
      <div className="group/task-header w-full bg-background p-3">
        <div className="flex min-w-0 items-center gap-x-2 overflow-hidden">
          {/*
            The title and its overflow menu travel together, so the menu reads
            as acting on the task named beside it rather than on the view.
          */}
          <div className="flex min-w-0 flex-1 items-center gap-x-2 overflow-hidden">
            <TaskBreadcrumb
              rename={rename}
              renderMenuItems={renderMenuItems}
              task={task}
            />

            <div className="shrink-0">
              <TaskActionsMenu renderMenuItems={renderMenuItems} />
            </div>
          </div>

          <div className="flex min-w-8 shrink items-center justify-end gap-x-2 overflow-hidden">
            {/* Counts are a debugging aid, not something to read at a glance,
                so they fade in with the header rather than sitting there. The
                space stays reserved either way, so nothing shifts on hover. */}
            {isDeveloperMode && (
              <div className="min-w-0 shrink overflow-hidden opacity-0 transition-opacity group-focus-within/task-header:opacity-100 group-hover/task-header:opacity-100">
                <TaskUsageSummary
                  id={task.id}
                  onClick={() => {
                    setDebugDialogOpen(true);
                  }}
                />
              </div>
            )}
            {/* Stays open across selections: picking a file only swaps what the
                artifact panel shows, and browsing a few in a row is the point
                of opening the list. Escape or a click outside dismisses it. */}
            {hasFilesToBrowse && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    aria-label="Files"
                    className={toolbarClassName({
                      className:
                        "shrink-0 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
                      pressed: false,
                    })}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <FoldersIcon className="size-4" />
                  </Button>
                </PopoverTrigger>
                {/* The panel scrolls, not the list inside it: height is whatever
                    the files need, capped by the space Radix measured under the
                    trigger, divided into this content's own zoomed pixels. */}
                <PopoverContent
                  align="end"
                  className="max-h-[min(560px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-100 overflow-y-auto p-0"
                >
                  <TaskFiles
                    activeFilePath={activeFilePath}
                    attachedFolders={attachedFolders}
                    files={files}
                    onFileSelect={onFileSelect}
                    task={task}
                  />
                </PopoverContent>
              </Popover>
            )}

            {/* Unlike the files trigger, this does not come and go with what
                the task holds: it is how the pane is reopened after being
                closed, so it has to be findable on a task with nothing in it
                yet. It leaves when the pane opens, because the pane's own tab
                strip then carries it on the same pixel. */}
            {!pane.open && <PaneToggle taskId={task.id} />}
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
