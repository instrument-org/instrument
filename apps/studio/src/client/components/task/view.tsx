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
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  encodeBrowserTargetId,
  type StoreId,
  type Task,
} from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import { TaskBrowserPanel } from "./browser-panel";
import { TaskSidebar, type TaskSidebarMode } from "./sidebar";

const PANEL_SIZES = {
  artifactMin: 300,
  sidebarMin: 350,
};

// Default split when the artifact panel opens: favor the artifact and keep the
// chat compact. These are proportions clamped by the pixel min sizes, so the
// sidebar still snaps to sidebarMin on narrow windows.
const OPEN_LAYOUT = { artifact: 65, sidebar: 35 };

const LAYOUT = {
  closed: { sidebar: 100 },
  open: OPEN_LAYOUT,
};

export function TaskView({
  artifactPanel,
  attachedFolders,
  files,
  promptDraft,
  selectedModelURI,
  selectedSessionId,
  showTutorial,
  sidebar,
  task,
}: {
  artifactPanel: ArtifactPanel | undefined;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  promptDraft: string;
  selectedModelURI: AIGatewayModelURI.Type | undefined;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  sidebar: TaskSidebarMode;
  task: Task;
}) {
  const navigate = useNavigate();
  const openFileViewer = useSetAtom(openFileViewerAtom);
  const assetBaseUrl = getAssetBaseUrl(task.id);

  // Bumped to force the file viewer to remount when the user re-opens the
  // already-active artifact, snapping an HTML preview back to its entry page
  // after an in-iframe link navigated it away.
  const [artifactReloadNonce, setArtifactReloadNonce] = useState(0);

  const filePanel = artifactPanel?.type === "file" ? artifactPanel : undefined;
  const browserPanel = artifactPanel?.type === "browser";

  // Whether a live browser exists for this session, used to show the guest vs a
  // placeholder in the browser panel.
  const liveTargetId = selectedSessionId
    ? encodeBrowserTargetId(task.id, selectedSessionId)
    : undefined;
  const attachedTargets = useBrowserTargets();
  const browserActive = Boolean(
    liveTargetId && attachedTargets.has(liveTargetId),
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

  const {
    data: fileInfo,
    dataUpdatedAt,
    errorUpdatedAt,
  } = useQuery(
    rpcClient.workspace.task.files.fileInfo.queryOptions({
      input: filePanel
        ? {
            filePath: filePanel.filePath,
            taskId: task.id,
          }
        : skipToken,
    }),
  );

  const currentFileMetadata = files?.find(
    (file) => file.filePath === filePanel?.filePath,
  );
  const currentModifiedAt =
    currentFileMetadata?.modifiedAt ?? fileInfo?.modifiedAt;
  const currentFile: null | TaskFileViewerFile =
    fileInfo && currentModifiedAt !== undefined
      ? {
          ...fileInfo,
          modifiedAt: currentModifiedAt,
          taskId: task.id,
          url: getAssetUrl({
            assetBase: assetBaseUrl,
            filePath: fileInfo.filePath,
            version: currentModifiedAt,
          }),
        }
      : null;

  // Whether the panel is still working out what this file is. "Not found" is a
  // claim about the file, so it waits for an answer.
  //
  // The answer is "has this query ever delivered anything for this file", read
  // off the update stamps, which reset to 0 when the key changes. The status
  // flags cannot be used for it: while the query is disabled -- which it is for
  // the render where the path arrives -- it reports neither pending nor
  // fetching while still holding no data, so a check on those shows the missing
  // state to every file on its way in.
  const hasFileAnswer = dataUpdatedAt > 0 || errorUpdatedAt > 0;
  const isResolvingFile =
    !hasFileAnswer || (fileInfo !== undefined && currentModifiedAt === undefined);

  const handleArtifactPanelClose = () => {
    void navigate({
      from: "/tasks/$id/",
      params: { id: task.id },
      replace: true,
      search: (prev) => ({ ...prev, artifactPanel: undefined }),
    });
  };

  const handleFileSelect = (file: TaskFileViewerFile) => {
    if (filePanel?.filePath === file.filePath) {
      setArtifactReloadNonce((nonce) => nonce + 1);
    }
    void navigate({
      from: "/tasks/$id/",
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

  const handleSidebarChange = (nextSidebar: TaskSidebarMode) => {
    void navigate({
      from: "/tasks/$id/",
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
    promptDraft,
    selectedModelURI,
    selectedSessionId,
    showTutorial,
    task,
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <ResizablePanelGroup
        className="h-full"
        defaultLayout={showArtifactPanel ? LAYOUT.open : LAYOUT.closed}
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize={showArtifactPanel ? `${OPEN_LAYOUT.sidebar}%` : "100%"}
          id="sidebar"
          minSize={PANEL_SIZES.sidebarMin}
        >
          <TaskSidebar
            activeFilePath={filePanel?.filePath ?? null}
            attachedFolders={attachedFolders}
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
              defaultSize={`${OPEN_LAYOUT.artifact}%`}
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
                      key={`${currentFile.url}#${artifactReloadNonce}`}
                      onClose={handleArtifactPanelClose}
                      onExpand={() => {
                        openFileViewer({ files: [currentFile] });
                      }}
                    />
                  </div>
                ) : filePanel ? (
                  // Only claim the file is gone once the lookup has answered.
                  // Rendering the missing state while the query is still in
                  // flight flashes "File not found" over every file on its way
                  // in, which is a lie the panel then corrects a frame later.
                  // The wait itself shows nothing: it is over faster than the
                  // eye settles, so anything drawn there is a flicker between
                  // two files rather than a sign of progress.
                  <ArtifactPanelShell
                    filePath={filePanel.filePath}
                    onClose={handleArtifactPanelClose}
                  >
                    {!isResolvingFile && <MissingFileNotice />}
                  </ArtifactPanelShell>
                ) : null}
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * The artifact panel's frame for a file that has no viewer mounted in it,
 * either because the file is still being looked up or because it is not there.
 * Matches `FileViewer`'s own frame so the header does not move when one
 * replaces the other.
 */
function ArtifactPanelShell({
  children,
  filePath,
  onClose,
}: {
  children: ReactNode;
  filePath: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm">
      <div className="flex min-w-0 shrink-0 items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1 truncate text-xs font-medium">
          {filePath}
        </div>
        <Button onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function MissingFileNotice() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-medium">File not found</div>
        <div className="mt-1 text-sm text-muted-foreground">
          This chat references a file that is not present in the task folder.
        </div>
      </div>
    </div>
  );
}
