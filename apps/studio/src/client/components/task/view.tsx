import {
  openFileViewerAtom,
  type TaskFileViewerFile,
} from "@/client/atoms/task-file-viewer";
import {
  FileViewer,
  fileViewerClassName,
  FileViewerHeader,
} from "@/client/components/file-viewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { useTaskPaneActions } from "@/client/hooks/use-task-pane";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  encodeBrowserTargetId,
  type StoreId,
  type Task,
  TaskPane,
} from "@instrument-org/workspace/client";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode } from "react";

import { FileLoading } from "../file-loading";
import { TaskBrowserPanel } from "./browser-panel";
import { PaneTabs } from "./pane-tabs";
import { TaskSidebar } from "./sidebar";

const PANEL_SIZES = {
  artifactMin: 300,
  sidebarMin: 350,
};

// Default split when the pane opens: favor the pane and keep the chat compact.
// These are proportions clamped by the pixel min sizes, so the sidebar still
// snaps to sidebarMin on narrow windows.
const OPEN_LAYOUT = { artifact: 65, sidebar: 35 };

const LAYOUT = {
  closed: { sidebar: 100 },
  open: OPEN_LAYOUT,
};

// The pane is the card. Whatever it is showing sits inside this, so the tab
// strip, a viewer's title row and a viewer's own toolbar stack as one band.
const paneSurfaceClassName =
  "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm";

// ...and the thing inside gives up the card it would otherwise draw, rather
// than nesting a second rounded surface a few pixels inside the first.
const paneContentClassName = "rounded-none bg-transparent shadow-none";

export function TaskView({
  attachedFolders,
  files,
  pane,
  promptDraft,
  selectedModelURI,
  selectedSessionId,
  showTutorial,
  task,
}: {
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  pane: TaskPane.Type;
  promptDraft: string;
  selectedModelURI: AIGatewayModelURI.Type | undefined;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  task: Task;
}) {
  const openFileViewer = useSetAtom(openFileViewerAtom);
  const assetBaseUrl = getAssetBaseUrl(task.id);
  const { closeTab, openFiles, selectTab } = useTaskPaneActions(task.id);

  // Whether a live browser exists for this session, used to show the guest vs a
  // placeholder in the browser panel.
  const liveTargetId = selectedSessionId
    ? encodeBrowserTargetId(task.id, selectedSessionId)
    : undefined;
  const attachedTargets = useBrowserTargets();
  const browserActive = Boolean(
    liveTargetId && attachedTargets.has(liveTargetId),
  );

  // The browser is a fixed first tab rather than one of the stored ones. It is
  // what the pane opens onto when nothing else is in it, which is what keeps
  // "open the pane" from ever being a request that lands on nothing -- and with
  // a tab always present, the strip always has somewhere to put the control
  // that closes it again.
  const tabs: TaskPane.Tab[] = [
    { type: "browser" },
    ...pane.tabs.filter((tab) => tab.type !== "browser"),
  ];

  const selected = TaskPane.selectedTab({ ...pane, tabs });
  const filePanel = selected?.type === "file" ? selected : undefined;

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

  const showArtifactPanel = pane.open;

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
    !hasFileAnswer ||
    (fileInfo !== undefined && currentModifiedAt === undefined);

  const handleFileSelect = (file: TaskFileViewerFile) => {
    openFiles([file.filePath]);
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
            selectedSessionId={selectedSessionId}
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
                {/* One card, with the strip as its first row. The viewers below
                    already stack a title and a toolbar inside this same frame,
                    so the tabs join that band instead of floating above the
                    pane on the task's own background. */}
                <div className={paneSurfaceClassName}>
                  <PaneTabs
                    onClose={closeTab}
                    onSelect={selectTab}
                    selectedKey={
                      selected ? TaskPane.tabKey(selected) : undefined
                    }
                    tabs={tabs}
                    taskId={task.id}
                  />

                  <div className="min-h-0 flex-1">
                    {selected?.type === "browser" && selectedSessionId ? (
                      <TaskBrowserPanel
                        active={browserActive}
                        className={paneContentClassName}
                        sessionId={selectedSessionId}
                        taskId={task.id}
                      />
                    ) : currentFile ? (
                      <FileViewer
                        className={paneContentClassName}
                        file={currentFile}
                        key={currentFile.url}
                        onExpand={() => {
                          openFileViewer({ files: [currentFile] });
                        }}
                      />
                    ) : filePanel ? (
                      // Only claim the file is gone once the lookup has
                      // answered. Rendering the missing state while the query is
                      // still in flight flashes "File not found" over every file
                      // on its way in, which is a lie the panel then corrects a
                      // frame later. The wait itself shows nothing: it is over
                      // faster than the eye settles, so anything drawn there is
                      // a flicker between two files rather than a sign of
                      // progress.
                      <ArtifactPanelShell filePath={filePanel.filePath}>
                        {isResolvingFile ? (
                          <FileLoading />
                        ) : (
                          <MissingFileNotice />
                        )}
                      </ArtifactPanelShell>
                    ) : null}
                  </div>
                </div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * The pane's frame for a file that has no viewer mounted in it, either because
 * the file is still being looked up or because it is not there. Built from
 * `FileViewer`'s own frame and header so nothing moves when one replaces the
 * other -- including the hairline under the chrome, which sits a row lower for
 * a format whose viewer opens a toolbar.
 */
function ArtifactPanelShell({
  children,
  filePath,
}: {
  children: ReactNode;
  filePath: string;
}) {
  const filename = filePath.slice(filePath.lastIndexOf("/") + 1);

  return (
    <div className={cn(fileViewerClassName, paneContentClassName)}>
      {/* No mime type: that is part of what the panel is still waiting on.
          Every format whose viewer opens a toolbar is identified by its
          extension anyway, so the chrome band lays out the same either way. */}
      <FileViewerHeader filename={filename} filePath={filePath} />
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
