import { Folder } from "@/client/components/icons/folder";
import { ProjectSettingsDialog } from "@/client/components/project-settings-dialog";
import { Button } from "@/client/components/ui/button";
import { Toggle } from "@/client/components/ui/toggle";
import { ToolbarFavoriteAction } from "@/client/components/ui/toolbar-favorite-action";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import {
  type StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { useNavigate } from "@tanstack/react-router";
import { FileArchive, Share2 } from "lucide-react";
import { useState } from "react";

import { ReplaySessionModal } from "../debug/replay-session-modal";
import { ExportZipModal } from "../export-zip-modal";
import { ProjectDebugDialog } from "../project-debug-dialog";
import { ProjectActionsMenu, ProjectChatPicker } from "../project-menu";
import { ProjectUsageSummary } from "../project-usage-summary";
import { RestoreVersionModal } from "../restore-version-modal";
import { SessionContextRing } from "../session-context-ring";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function ProjectToolbar({
  onSidebarChange,
  project,
  selectedSessionId,
  showFilesToggle,
  sidebar,
  versionRef,
}: {
  onSidebarChange: (sidebar: "chat" | "files") => void;
  project: WorkspaceAppProject;
  selectedSessionId?: StoreId.Session;
  showFilesToggle: boolean;
  sidebar: "chat" | "files";
  versionRef?: string;
}) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [exportZipModalOpen, setExportZipModalOpen] = useState(false);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const navigate = useNavigate();

  const isDeveloperMode = useDeveloperMode();

  const handleExitVersion = () => {
    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain: project.subdomain },
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { type: "app" },
      }),
    });
  };

  const handleRestoreVersion = () => {
    setRestoreModalOpen(true);
  };

  return (
    <>
      <div className="w-full bg-background py-2 pr-2 pl-3">
        <div className="flex items-center gap-2">
          <ProjectChatPicker
            onChatClick={() => {
              onSidebarChange("chat");
            }}
            project={project}
            selectedSessionId={selectedSessionId}
            sidebar={sidebar}
          />

          {showFilesToggle && (
            <Toggle
              aria-label="Show files"
              onPressedChange={() => {
                onSidebarChange("files");
              }}
              pressed={sidebar === "files"}
              size="sm"
              variant="tab"
            >
              <Folder className="size-4" />
              <span>Files</span>
            </Toggle>
          )}

          <div className="flex-1" />

          <div className="flex min-w-0 items-center gap-3">
            {isDeveloperMode && (
              <div className="min-w-0 shrink">
                <ProjectUsageSummary
                  onClick={() => {
                    setDebugDialogOpen(true);
                  }}
                  project={project}
                />
              </div>
            )}
            {isDeveloperMode && selectedSessionId && (
              <SessionContextRing
                selectedSessionId={selectedSessionId}
                subdomain={project.subdomain}
              />
            )}
            {versionRef ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  onClick={handleExitVersion}
                  size="sm"
                  variant="secondary"
                >
                  Exit
                </Button>
                <Button onClick={handleRestoreVersion} size="sm">
                  Restore this version
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <ToolbarFavoriteAction project={project} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="h-7 gap-1.5 px-2.5 has-[>svg]:px-2.5"
                      size="sm"
                      variant="secondary"
                    >
                      <Share2 className="size-4" />
                      Share
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setExportZipModalOpen(true);
                      }}
                    >
                      <FileArchive className="size-4" />
                      Export as zip
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ProjectActionsMenu
                  onDebugClick={() => {
                    setDebugDialogOpen(true);
                  }}
                  onReplayClick={() => {
                    setReplayModalOpen(true);
                  }}
                  onSettingsClick={() => {
                    setSettingsDialogOpen(true);
                  }}
                  project={project}
                  selectedSessionId={selectedSessionId}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <ProjectSettingsDialog
        onOpenChange={setSettingsDialogOpen}
        open={settingsDialogOpen}
        project={project}
      />

      {versionRef && (
        <RestoreVersionModal
          isOpen={restoreModalOpen}
          onClose={() => {
            setRestoreModalOpen(false);
          }}
          onRestore={() => {
            // The modal handles the restore logic and navigation
            setRestoreModalOpen(false);
          }}
          projectSubdomain={project.subdomain}
          versionRef={versionRef}
        />
      )}

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
