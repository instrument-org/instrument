import {
  openFileViewerAtom,
  type ProjectFileViewerFile,
} from "@/client/atoms/project-file-viewer";
import { AppView } from "@/client/components/app-view";
import { ProjectFileViewer } from "@/client/components/project/file-viewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { VersionOverlay } from "@/client/components/version-overlay";
import { useReload } from "@/client/hooks/use-reload";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { ProjectSidebar, type ProjectSidebarMode } from "./sidebar";

const PANEL_SIZES = {
  artifactMin: 300,
  sidebarMin: 350,
};

const LAYOUT = {
  closed: Object.fromEntries([["sidebar", 100]]),
  open: Object.fromEntries([
    ["sidebar", 50],
    ["artifact", 50],
  ]),
};

export function ProjectView({
  artifactPanel,
  attachedFolders,
  files,
  hasAppModifications,
  project,
  selectedModelURI,
  selectedSessionId,
  showVersions,
  sidebar,
}: {
  artifactPanel: ArtifactPanel | undefined;
  attachedFolders: RPCOutput["workspace"]["project"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["project"]["git"]["listFiles"] | undefined;
  hasAppModifications: boolean;
  project: WorkspaceAppProject;
  selectedModelURI: AIGatewayModelURI.Type | undefined;
  selectedSessionId?: StoreId.Session;
  showVersions?: boolean;
  sidebar: ProjectSidebarMode;
}) {
  const navigate = useNavigate();
  const openFileViewer = useSetAtom(openFileViewerAtom);

  const { data: replayStatus } = useQuery(
    rpcClient.workspace.debug.live.replayStatus.experimental_liveOptions({
      input: selectedSessionId ? { sessionId: selectedSessionId } : skipToken,
    }),
  );

  const isReplayActive = replayStatus?.isActive ?? false;

  const cancelReplayMutation = useMutation(
    rpcClient.workspace.debug.cancelReplay.mutationOptions(),
  );

  const handleCancelReplay = () => {
    if (selectedSessionId) {
      cancelReplayMutation.mutate({ sessionId: selectedSessionId });
    }
  };

  const isViewingApp = artifactPanel?.type === "app";
  const isViewingFile = artifactPanel?.type === "file";
  const selectedAppVersion =
    artifactPanel?.type === "app" ? artifactPanel.versionRef : undefined;
  const showArtifactPanel = isViewingApp || isViewingFile;

  const { data: fileInfo } = useQuery(
    rpcClient.workspace.project.git.fileInfo.queryOptions({
      input:
        artifactPanel?.type === "file"
          ? {
              filePath: artifactPanel.filePath,
              projectSubdomain: project.subdomain,
              versionRef: artifactPanel.fileVersion,
            }
          : skipToken,
      placeholderData: keepPreviousData,
    }),
  );

  const currentFile: null | ProjectFileViewerFile = fileInfo
    ? { ...fileInfo, projectSubdomain: project.subdomain }
    : null;

  const handleAppSelect = () => {
    if (isViewingApp) {
      return;
    }
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

  const handleArtifactPanelClose = () => {
    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain: project.subdomain },
      replace: true,
      search: (prev) => ({ ...prev, artifactPanel: undefined }),
    });
  };

  const handleFileSelect = (file: ProjectFileViewerFile) => {
    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain: project.subdomain },
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: {
          filePath: file.filePath,
          fileVersion: file.versionRef,
          type: "file",
        },
      }),
    });
  };

  const handleVersionsToggle = () => {
    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain: project.subdomain },
      replace: true,
      search: (prev) => ({
        ...prev,
        showVersions: showVersions ? undefined : true,
      }),
    });
  };

  useReload(
    useCallback(() => {
      if (!isViewingApp) {
        window.location.reload();
      }
    }, [isViewingApp]),
  );

  const handleSidebarChange = (nextSidebar: ProjectSidebarMode) => {
    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain: project.subdomain },
      replace: true,
      search: (prev) => ({
        ...prev,
        showVersions: undefined,
        sidebar: nextSidebar === "chat" ? undefined : nextSidebar,
      }),
    });
  };

  const chatProps = {
    isReplayActive,
    isViewingApp,
    onCancelReplay: handleCancelReplay,
    project,
    selectedModelURI,
    selectedSessionId,
    showVersions,
    versionRef: selectedAppVersion,
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <ResizablePanelGroup
        defaultLayout={showArtifactPanel ? LAYOUT.open : LAYOUT.closed}
        orientation="horizontal"
        style={{ height: "100%" }}
      >
        <ResizablePanel
          defaultSize={showArtifactPanel ? "50%" : "100%"}
          id="sidebar"
          minSize={PANEL_SIZES.sidebarMin}
        >
          <ProjectSidebar
            activeFilePath={
              artifactPanel?.type === "file" ? artifactPanel.filePath : null
            }
            attachedFolders={attachedFolders}
            chatProps={chatProps}
            files={files}
            hasAppModifications={hasAppModifications}
            isAppViewOpen={isViewingApp}
            onAppSelect={handleAppSelect}
            onFileSelect={handleFileSelect}
            onSidebarChange={handleSidebarChange}
            onVersionsToggle={handleVersionsToggle}
            project={project}
            selectedAppVersion={selectedAppVersion}
            selectedSessionId={selectedSessionId}
            showVersions={showVersions}
            sidebar={sidebar}
          />
        </ResizablePanel>

        {showArtifactPanel && (
          <>
            <ResizableHandle disableDoubleClick />

            <ResizablePanel
              defaultSize="50%"
              id="artifact"
              minSize={PANEL_SIZES.artifactMin}
            >
              <div className="flex h-full flex-1 flex-col overflow-hidden bg-secondary p-2">
                {isViewingFile ? (
                  currentFile ? (
                    <div className="flex h-full overflow-hidden">
                      <ProjectFileViewer
                        file={currentFile}
                        fullSize
                        isInPanel
                        onClose={handleArtifactPanelClose}
                        onExpand={() => {
                          openFileViewer({ files: [currentFile] });
                        }}
                      />
                    </div>
                  ) : null
                ) : isViewingApp ? (
                  <div className="relative flex flex-1 flex-col">
                    <AppView
                      app={project}
                      className="overflow-hidden rounded-lg"
                      isVersionsOpen={showVersions}
                      onClose={handleArtifactPanelClose}
                      onVersionsToggle={handleVersionsToggle}
                      shouldReload={!selectedAppVersion}
                    />
                    {selectedAppVersion && (
                      <VersionOverlay
                        projectSubdomain={project.subdomain}
                        versionRef={selectedAppVersion}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
