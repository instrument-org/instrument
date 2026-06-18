import {
  openFileViewerAtom,
  type ProjectFileViewerFile,
} from "@/client/atoms/project-file-viewer";
import { FileViewer } from "@/client/components/file-viewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useReload } from "@/client/hooks/use-reload";
import { getAssetUrl } from "@/client/lib/get-asset-url";
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
  project,
  selectedModelURI,
  selectedSessionId,
  showTutorial,
  sidebar,
}: {
  artifactPanel: ArtifactPanel | undefined;
  attachedFolders: RPCOutput["workspace"]["project"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["project"]["files"]["list"] | undefined;
  project: WorkspaceAppProject;
  selectedModelURI: AIGatewayModelURI.Type | undefined;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  sidebar: ProjectSidebarMode;
}) {
  const navigate = useNavigate();
  const openFileViewer = useSetAtom(openFileViewerAtom);

  const { data: replayStatus } = useQuery(
    rpcClient.workspace.replay.live.status.experimental_liveOptions({
      input: selectedSessionId ? { sessionId: selectedSessionId } : skipToken,
    }),
  );

  const isReplayActive = replayStatus?.isActive ?? false;

  const cancelReplayMutation = useMutation(
    rpcClient.workspace.replay.cancel.mutationOptions(),
  );

  const handleCancelReplay = () => {
    if (selectedSessionId) {
      cancelReplayMutation.mutate({ sessionId: selectedSessionId });
    }
  };

  const showArtifactPanel = artifactPanel !== undefined;

  const { data: fileInfo } = useQuery(
    rpcClient.workspace.project.files.fileInfo.queryOptions({
      input: artifactPanel
        ? {
            filePath: artifactPanel.filePath,
            projectSubdomain: project.subdomain,
          }
        : skipToken,
      placeholderData: keepPreviousData,
    }),
  );

  const currentFileMetadata = files?.find(
    (file) => file.filePath === artifactPanel?.filePath,
  );
  const currentFile: null | ProjectFileViewerFile = fileInfo
    ? {
        ...fileInfo,
        modifiedAt:
          artifactPanel?.modifiedAt ?? currentFileMetadata?.modifiedAt,
        projectSubdomain: project.subdomain,
        url: getAssetUrl({
          assetBase: project.urls.assetBase,
          filePath: fileInfo.filePath,
          version: artifactPanel?.modifiedAt ?? currentFileMetadata?.modifiedAt,
        }),
      }
    : null;

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
          modifiedAt: file.modifiedAt,
          type: "file",
        },
      }),
    });
  };

  useReload(
    useCallback(() => {
      window.location.reload();
    }, []),
  );

  const handleSidebarChange = (nextSidebar: ProjectSidebarMode) => {
    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain: project.subdomain },
      replace: true,
      search: (prev) => ({
        ...prev,
        sidebar: nextSidebar === "chat" ? undefined : nextSidebar,
      }),
    });
  };

  const chatProps = {
    isReplayActive,
    onCancelReplay: handleCancelReplay,
    project,
    selectedModelURI,
    selectedSessionId,
    showTutorial,
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <ResizablePanelGroup
        className="h-full"
        defaultLayout={showArtifactPanel ? LAYOUT.open : LAYOUT.closed}
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize={showArtifactPanel ? "50%" : "100%"}
          id="sidebar"
          minSize={PANEL_SIZES.sidebarMin}
        >
          <ProjectSidebar
            activeFilePath={artifactPanel?.filePath ?? null}
            attachedFolders={attachedFolders}
            chatProps={chatProps}
            files={files}
            onFileSelect={handleFileSelect}
            onSidebarChange={handleSidebarChange}
            project={project}
            selectedSessionId={selectedSessionId}
            sidebar={sidebar}
          />
        </ResizablePanel>

        {showArtifactPanel && (
          <>
            <ResizableHandle />

            <ResizablePanel
              defaultSize="50%"
              id="artifact"
              minSize={PANEL_SIZES.artifactMin}
            >
              <div className="flex h-full flex-1 animate-in flex-col p-2 duration-150 fade-in-0 slide-in-from-right-2">
                {currentFile ? (
                  <div className="flex h-full">
                    <FileViewer
                      file={currentFile}
                      fullSize
                      key={currentFile.url}
                      onClose={handleArtifactPanelClose}
                      onExpand={() => {
                        openFileViewer({ files: [currentFile] });
                      }}
                    />
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
