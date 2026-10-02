import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

// Opens a file with the application the computer would use for it.
export function useOpenFile() {
  const openPathMutation = useMutation(
    rpcClient.utils.openPath.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open file", {
          description: error.message,
        });
      },
    }),
  );

  return (file: Pick<ViewerFile, "hostPath">) => {
    openPathMutation.mutate({ filepath: file.hostPath });
  };
}

// Opens a file with a specific chosen application ("Open with").
export function useOpenFileWith() {
  const openFileWithMutation = useMutation(
    rpcClient.utils.openFileWith.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open file", {
          description: error.message,
        });
      },
    }),
  );

  return (file: Pick<ViewerFile, "hostPath">, appPath: string) => {
    openFileWithMutation.mutate({ appPath, filePath: file.hostPath });
  };
}
