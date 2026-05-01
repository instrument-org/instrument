import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { ProjectChat } from "@/client/components/project/chat";
import { ProjectFiles } from "@/client/components/project/explorer";
import { Button } from "@/client/components/ui/button";
import { VersionList } from "@/client/components/version-list";
import { type RPCOutput } from "@/client/rpc/client";
import {
  type StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react";
import { type ComponentProps } from "react";
import { z } from "zod";

import { ProjectToolbar } from "./toolbar";

export const ProjectSidebarModeSchema = z.enum(["chat", "files"]);
export type ProjectSidebarMode = z.output<typeof ProjectSidebarModeSchema>;

export function ProjectSidebar({
  activeFilePath,
  attachedFolders,
  chatProps,
  files,
  hasAppModifications,
  isAppViewOpen,
  onAppSelect,
  onFileSelect,
  onSidebarChange,
  onVersionsToggle,
  project,
  selectedAppVersion,
  selectedSessionId,
  showVersions,
  sidebar,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["project"]["state"]["get"]["attachedFolders"];
  chatProps: ComponentProps<typeof ProjectChat>;
  files: RPCOutput["workspace"]["project"]["git"]["listFiles"] | undefined;
  hasAppModifications: boolean;
  isAppViewOpen: boolean;
  onAppSelect: () => void;
  onFileSelect: (file: ProjectFileViewerFile) => void;
  onSidebarChange: (sidebar: ProjectSidebarMode) => void;
  onVersionsToggle: () => void;
  project: WorkspaceAppProject;
  selectedAppVersion: string | undefined;
  selectedSessionId?: StoreId.Session;
  showVersions?: boolean;
  sidebar: ProjectSidebarMode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ProjectToolbar
        onSidebarChange={onSidebarChange}
        project={project}
        selectedSessionId={selectedSessionId}
        sidebar={sidebar}
        versionRef={selectedAppVersion}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {showVersions ? (
          <div className="flex h-full flex-col overflow-hidden bg-background">
            <div className="flex items-center justify-between border-b p-2">
              <h2 className="px-2 font-semibold">Versions</h2>
              <Button onClick={onVersionsToggle} size="icon" variant="ghost">
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <VersionList
                // Very basic filtering for now
                filterByPath="./src"
                isViewingApp={isAppViewOpen}
                projectSubdomain={project.subdomain}
                versionRef={selectedAppVersion}
              />
            </div>
          </div>
        ) : sidebar === "files" ? (
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <ProjectFiles
              activeFilePath={activeFilePath}
              attachedFolders={attachedFolders}
              files={files}
              isAppViewOpen={isAppViewOpen}
              onAppSelect={onAppSelect}
              onFileSelect={onFileSelect}
              project={project}
              showAppEntry={hasAppModifications}
            />
          </div>
        ) : (
          <ProjectChat {...chatProps} />
        )}
      </div>
    </div>
  );
}
