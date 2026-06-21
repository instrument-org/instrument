import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { ProjectChat } from "@/client/components/project/chat";
import { ProjectFiles } from "@/client/components/project/project-files";
import { type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type WorkspaceAppProject } from "@instrument-org/workspace/client";
import { Activity, type ComponentProps } from "react";
import { z } from "zod";

import { CurrentProjectFilesProvider } from "./current-project-files";
import { ProjectToolbar } from "./toolbar";

export const ProjectSidebarModeSchema = z.enum(["chat", "files"]);
export type ProjectSidebarMode = z.output<typeof ProjectSidebarModeSchema>;

export function ProjectSidebar({
  activeFilePath,
  attachedFolders,
  chatProps,
  files,
  onFileSelect,
  onSidebarChange,
  project,
  selectedSessionId,
  sidebar,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["project"]["state"]["get"]["attachedFolders"];
  chatProps: ComponentProps<typeof ProjectChat>;
  files: RPCOutput["workspace"]["project"]["files"]["list"] | undefined;
  onFileSelect: (file: ProjectFileViewerFile) => void;
  onSidebarChange: (sidebar: ProjectSidebarMode) => void;
  project: WorkspaceAppProject;
  selectedSessionId?: StoreId.Session;
  sidebar: ProjectSidebarMode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ProjectToolbar
        onSidebarChange={onSidebarChange}
        project={project}
        selectedSessionId={selectedSessionId}
        sidebar={sidebar}
      />

      <CurrentProjectFilesProvider files={files}>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Activity mode={sidebar === "files" ? "visible" : "hidden"}>
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
              <ProjectFiles
                activeFilePath={activeFilePath}
                attachedFolders={attachedFolders}
                files={files}
                onFileSelect={onFileSelect}
                project={project}
              />
            </div>
          </Activity>

          <Activity mode={sidebar === "chat" ? "visible" : "hidden"}>
            <ProjectChat {...chatProps} />
          </Activity>
        </div>
      </CurrentProjectFilesProvider>
    </div>
  );
}
