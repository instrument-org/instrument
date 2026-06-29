import {
  openFileViewerAtom,
  type TaskFileViewerFile,
} from "@/client/atoms/task-file-viewer";
import { FileViewer } from "@/client/components/file-viewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useReload } from "@/client/hooks/use-reload";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { TaskBrowserPanel } from "./browser-panel";
import { TaskSidebar, type TaskSidebarMode } from "./sidebar";

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

export function TaskView({
  artifactPanel,
  attachedFolders,
  files,
  selectedModelURI,
  selectedSessionId,
  showTutorial,
  sidebar,
  task,
}: {
  artifactPanel: ArtifactPanel | undefined;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  selectedModelURI: AIGatewayModelURI.Type | undefined;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  sidebar: TaskSidebarMode;
  task: Task;
}) {
  const navigate = useNavigate();
  const openFileViewer = useSetAtom(openFileViewerAtom);
  const assetBaseUrl = getAssetBaseUrl(task.id);

  const filePanel = artifactPanel?.type === "file" ? artifactPanel : undefined;
  const browserPanel = artifactPanel?.type === "browser";

  // Whether the agent has a live browser for this session, used to show the
  // guest vs a placeholder in the browser panel.
  const liveTargetId = selectedSessionId
    ? `${task.id}/${selectedSessionId}`
    : undefined;
  const { data: liveTargetIds } = useQuery(
    rpcClient.workspace.browser.listTargetIds.queryOptions({
      input: selectedSessionId ? { id: task.id } : skipToken,
      refetchInterval: 2000,
    }),
  );
  const browserActive = Boolean(
    liveTargetId && liveTargetIds?.includes(liveTargetId),
  );

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
    rpcClient.workspace.task.files.fileInfo.queryOptions({
      input: filePanel
        ? {
            filePath: filePanel.filePath,
            taskId: task.id,
          }
        : skipToken,
      placeholderData: keepPreviousData,
    }),
  );

  const currentFileMetadata = files?.find(
    (file) => file.filePath === filePanel?.filePath,
  );
  const currentFile: null | TaskFileViewerFile =
    fileInfo && currentFileMetadata
      ? {
          ...fileInfo,
          modifiedAt: currentFileMetadata.modifiedAt,
          taskId: task.id,
          url: getAssetUrl({
            assetBase: assetBaseUrl,
            filePath: fileInfo.filePath,
            version: currentFileMetadata.modifiedAt,
          }),
        }
      : null;

  const handleArtifactPanelClose = () => {
    void navigate({
      from: "/tasks/$id",
      params: { id: task.id },
      replace: true,
      search: (prev) => ({ ...prev, artifactPanel: undefined }),
    });
  };

  const handleFileSelect = (file: TaskFileViewerFile) => {
    void navigate({
      from: "/tasks/$id",
      params: { id: task.id },
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

  const handleSidebarChange = (nextSidebar: TaskSidebarMode) => {
    void navigate({
      from: "/tasks/$id",
      params: { id: task.id },
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
    selectedModelURI,
    selectedSessionId,
    showTutorial,
    task,
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
          <TaskSidebar
            activeFilePath={filePanel?.filePath ?? null}
            attachedFolders={attachedFolders}
            browserOpen={browserPanel}
            chatProps={chatProps}
            files={files}
            onFileSelect={handleFileSelect}
            onSidebarChange={handleSidebarChange}
            selectedSessionId={selectedSessionId}
            sidebar={sidebar}
            task={task}
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
                {browserPanel && selectedSessionId ? (
                  <TaskBrowserPanel
                    active={browserActive}
                    onClose={handleArtifactPanelClose}
                    sessionId={selectedSessionId}
                    taskId={task.id}
                  />
                ) : currentFile ? (
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
