import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { FileDropRegion } from "@/client/components/file-drop-region";
import { TaskChat } from "@/client/components/task/chat";
import { type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { type ComponentProps } from "react";

import { TaskToolbar } from "./toolbar";

export function TaskSidebar({
  activeFilePath,
  attachedFolders,
  chatProps,
  onFileSelect,
  selectedSessionId,
  task,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  chatProps: ComponentProps<typeof TaskChat>;
  onFileSelect: (file: TaskFileViewerFile) => void;
  selectedSessionId?: StoreId.Session;
  task: Task;
}) {
  return (
    // The chat column is the drop region, so the pane beside it -- a file
    // viewer, or the in-app browser's `<webview>` -- stays outside it without
    // anyone having to subtract it.
    <FileDropRegion className="flex h-full flex-col overflow-hidden bg-background">
      <TaskToolbar
        activeFilePath={activeFilePath}
        attachedFolders={attachedFolders}
        onFileSelect={onFileSelect}
        selectedSessionId={selectedSessionId}
        task={task}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <TaskChat {...chatProps} />
      </div>
    </FileDropRegion>
  );
}
