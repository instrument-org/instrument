import {
  openFileViewerAtom,
  type ProjectFileViewerFile,
} from "@/client/atoms/project-file-viewer";
import { AppView } from "@/client/components/app-view";
import { ProjectFileViewer } from "@/client/components/project-file-viewer";
import { VersionOverlay } from "@/client/components/version-overlay";
import { useReload } from "@/client/hooks/use-reload";
import { cn } from "@/client/lib/utils";
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
import { type DividerProps, Pane, SplitPane } from "react-split-pane";

import { ProjectSidebar, type ProjectSidebarMode } from "./project/sidebar";

function SplitDivider({
  className,
  direction,
  disabled,
  isDragging,
  onKeyDown,
  onPointerDown,
  style,
}: DividerProps) {
  const isHorizontal = direction === "horizontal";
  return (
    <div
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center",
        "bg-transparent transition-colors duration-200",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
        "after:absolute after:transition-all after:duration-200",
        isHorizontal
          ? "w-px cursor-col-resize after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent hover:after:scale-x-[3] hover:after:bg-muted-foreground/50"
          : "h-px cursor-row-resize after:inset-x-2 after:top-1/2 after:h-0.5 after:-translate-y-1/2 after:rounded-full after:bg-transparent hover:after:scale-y-[3] hover:after:bg-muted-foreground/50",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      data-dragging={isDragging}
      onKeyDown={disabled ? undefined : onKeyDown}
      onPointerDown={disabled ? undefined : onPointerDown}
      role="separator"
      style={{
        ...style,
        ...(isDragging && { backgroundColor: "hsl(var(--primary) / 0.5)" }),
      }}
      tabIndex={disabled ? -1 : 0}
    />
  );
}

const PANEL_SIZES = {
  artifactMin: 300,
  sidebarMin: 300,
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

  const sidebarPane = (
    <ProjectSidebar
      activeFilePath={
        artifactPanel?.type === "file" ? artifactPanel.filePath : null
      }
      attachedFolders={attachedFolders}
      chatProps={chatProps}
      files={files}
      hasAppModifications={hasAppModifications}
      isAppViewOpen={isViewingApp}
      isFullWidth={!showArtifactPanel}
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
  );

  const artifactPane = (
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
                openFileViewer({
                  files: [currentFile],
                });
              }}
            />
          </div>
        ) : null
      ) : (
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
      )}
    </div>
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      {showArtifactPanel ? (
        <SplitPane
          direction="horizontal"
          divider={SplitDivider}
          style={{ height: "100%" }}
        >
          <Pane minSize={PANEL_SIZES.sidebarMin} size="50%">
            {sidebarPane}
          </Pane>

          <Pane minSize={PANEL_SIZES.artifactMin}>{artifactPane}</Pane>
        </SplitPane>
      ) : (
        sidebarPane
      )}
    </div>
  );
}
