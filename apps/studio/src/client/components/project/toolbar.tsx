import { ShareExport } from "@/client/components/icons/share-export";
import { ProjectSettingsDialog } from "@/client/components/project/settings-dialog";
import { Button } from "@/client/components/ui/button";
import { Toggle, toolbarClassName } from "@/client/components/ui/toggle";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { FileArchiveIcon, FolderIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { ReplaySessionModal } from "../debug/replay-session-modal";
import { ExportZipModal } from "../export-zip-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ProjectActionsMenu } from "./actions-menu";
import { ProjectChatMenu } from "./chat-menu";
import { ProjectDebugDialog } from "./debug-dialog";
import { ProjectUsageSummary } from "./usage-summary";

export function ProjectToolbar({
  onSidebarChange,
  project,
  selectedSessionId,
  sidebar,
}: {
  onSidebarChange: (sidebar: "chat" | "files") => void;
  project: Task;
  selectedSessionId?: StoreId.Session;
  sidebar: "chat" | "files";
}) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [exportZipModalOpen, setExportZipModalOpen] = useState(false);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);

  const isDeveloperMode = useDeveloperMode();

  return (
    <>
      <div className="@container w-full bg-background p-3">
        <div className="flex min-w-0 items-center gap-x-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 items-center gap-x-1 overflow-hidden">
            <ProjectChatMenu
              onChatClick={() => {
                onSidebarChange("chat");
              }}
              projectTitle={project.title}
              selectedSessionId={selectedSessionId}
              sidebar={sidebar}
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
                <ProjectUsageSummary
                  id={project.id}
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
                <ProjectActionsMenu
                  id={project.id}
                  onDebugClick={() => {
                    setDebugDialogOpen(true);
                  }}
                  onReplayClick={() => {
                    setReplayModalOpen(true);
                  }}
                  onSettingsClick={() => {
                    setSettingsDialogOpen(true);
                  }}
                  selectedSessionId={selectedSessionId}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ProjectSettingsDialog
        onOpenChange={setSettingsDialogOpen}
        open={settingsDialogOpen}
        project={project}
      />

      <ExportZipModal
        isOpen={exportZipModalOpen}
        onClose={() => {
          setExportZipModalOpen(false);
        }}
        project={project}
      />

      <ProjectDebugDialog
        onOpenChange={setDebugDialogOpen}
        open={debugDialogOpen}
        project={project}
        selectedSessionId={selectedSessionId}
      />

      <ReplaySessionModal
        isOpen={replayModalOpen}
        onClose={() => {
          setReplayModalOpen(false);
        }}
        project={project}
        selectedSessionId={selectedSessionId}
      />
    </>
  );
}
