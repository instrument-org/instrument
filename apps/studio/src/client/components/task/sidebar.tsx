import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
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
    </div>
  );
}
