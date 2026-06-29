import { ShareExport } from "@/client/components/icons/share-export";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { Button } from "@/client/components/ui/button";
import { Toggle, toolbarClassName } from "@/client/components/ui/toggle";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { FileArchiveIcon, FolderIcon, GlobeIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ReplaySessionModal } from "../debug/replay-session-modal";
import { ExportZipModal } from "../export-zip-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { TaskActionsMenu } from "./actions-menu";
import { TaskDebugDialog } from "./debug-dialog";
import { TaskBreadcrumb } from "./task-breadcrumb";
import { TaskUsageSummary } from "./usage-summary";

export function TaskToolbar({
  browserOpen,
  onSidebarChange,
  selectedSessionId,
  sidebar,
  task,
}: {
  browserOpen: boolean;
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

  // The agent browser lives in the artifact panel; the toggle drives the
  // `artifactPanel` search param (the agent also opens it automatically).
  const navigate = useNavigate();
  const handleToggleBrowser = () => {
    void navigate({
      from: "/tasks/$id",
      params: { id: task.id },
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel:
          prev.artifactPanel?.type === "browser"
            ? undefined
            : { type: "browser" },
      }),
    });
  };

  return (
    <>
      <div className="@container w-full bg-background p-3">
        <div className="flex min-w-0 items-center gap-x-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 items-center gap-x-1 overflow-hidden">
            <TaskBreadcrumb
              onChatClick={() => {
                onSidebarChange("chat");
              }}
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

            <Toggle
              aria-label="Show browser"
              className="max-w-24 min-w-8 shrink overflow-hidden px-2"
              onPressedChange={handleToggleBrowser}
              pressed={browserOpen}
              size="sm"
              variant="toolbar"
            >
              <GlobeIcon className="size-4 shrink-0" />
              <span className="hidden min-w-0 truncate @min-[380px]:inline">
                Browser
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
                <TaskActionsMenu
                  id={task.id}
                  onDebugClick={() => {
                    setDebugDialogOpen(true);
                  }}
                  onReplayClick={() => {
                    setReplayModalOpen(true);
                  }}
                  onSettingsClick={() => {
                    setSettingsDialogOpen(true);
                  }}
                  projectId={task.projectId}
                  selectedSessionId={selectedSessionId}
                />
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
