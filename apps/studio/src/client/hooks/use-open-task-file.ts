import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

// Opens a task file with the OS-associated application.
export function useOpenTaskFile() {
  const openTaskFileMutation = useMutation(
    rpcClient.utils.openTaskFile.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open file", {
          description: error.message,
        });
      },
    }),
  );

  return (file: Pick<TaskFileViewerFile, "filePath" | "taskId">) => {
    openTaskFileMutation.mutate({
      filePath: file.filePath,
      id: file.taskId,
    });
  };
}

// Opens a task file with a specific chosen application ("Open with").
export function useOpenTaskFileWith() {
  const openTaskFileWithMutation = useMutation(
    rpcClient.utils.openTaskFileWith.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open file", {
          description: error.message,
        });
      },
    }),
  );

  return (
    file: Pick<TaskFileViewerFile, "filePath" | "taskId">,
    appPath: string,
  ) => {
    openTaskFileWithMutation.mutate({
      appPath,
      filePath: file.filePath,
      id: file.taskId,
    });
  };
}
