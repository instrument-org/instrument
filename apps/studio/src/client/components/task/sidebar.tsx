import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { TaskChat } from "@/client/components/task/chat";
import { type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { type ComponentProps } from "react";

import { CurrentTaskFilesProvider } from "./current-task-files";
import { TaskToolbar } from "./toolbar";

export function TaskSidebar({
  activeFilePath,
  attachedFolders,
  chatProps,
  files,
  onFileSelect,
  selectedSessionId,
  task,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  chatProps: ComponentProps<typeof TaskChat>;
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  onFileSelect: (file: TaskFileViewerFile) => void;
  selectedSessionId?: StoreId.Session;
  task: Task;
}) {
  return (
    // The provider covers the toolbar too: the file list hangs off it in a
    // popover, so it reads the same live files the chat does.
    <CurrentTaskFilesProvider files={files}>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <TaskToolbar
          activeFilePath={activeFilePath}
          attachedFolders={attachedFolders}
          files={files}
          onFileSelect={onFileSelect}
          selectedSessionId={selectedSessionId}
          task={task}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          <TaskChat {...chatProps} />
        </div>
      </div>
    </CurrentTaskFilesProvider>
  );
}
