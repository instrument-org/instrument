import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { TaskChat } from "@/client/components/task/chat";
import { TaskFiles } from "@/client/components/task/task-files";
import { type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { Activity, type ComponentProps } from "react";
import { z } from "zod";

import { CurrentTaskFilesProvider } from "./current-task-files";
import { TaskToolbar } from "./toolbar";

export const TaskSidebarModeSchema = z.enum(["chat", "files"]);
export type TaskSidebarMode = z.output<typeof TaskSidebarModeSchema>;

export function TaskSidebar({
  activeFilePath,
  attachedFolders,
  browserOpen,
  chatProps,
  files,
  onFileSelect,
  onSidebarChange,
  selectedSessionId,
  sidebar,
  task,
}: {
  activeFilePath: null | string;
  attachedFolders: RPCOutput["workspace"]["task"]["state"]["get"]["attachedFolders"];
  browserOpen: boolean;
  chatProps: ComponentProps<typeof TaskChat>;
  files: RPCOutput["workspace"]["task"]["files"]["list"] | undefined;
  onFileSelect: (file: TaskFileViewerFile) => void;
  onSidebarChange: (sidebar: TaskSidebarMode) => void;
  selectedSessionId?: StoreId.Session;
  sidebar: TaskSidebarMode;
  task: Task;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <TaskToolbar
        browserOpen={browserOpen}
        onSidebarChange={onSidebarChange}
        selectedSessionId={selectedSessionId}
        sidebar={sidebar}
        task={task}
      />

      <CurrentTaskFilesProvider files={files}>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Activity mode={sidebar === "files" ? "visible" : "hidden"}>
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
              <TaskFiles
                activeFilePath={activeFilePath}
                attachedFolders={attachedFolders}
                files={files}
                onFileSelect={onFileSelect}
                task={task}
              />
            </div>
          </Activity>

          <Activity mode={sidebar === "chat" ? "visible" : "hidden"}>
            <TaskChat {...chatProps} />
          </Activity>
        </div>
      </CurrentTaskFilesProvider>
    </div>
  );
}
