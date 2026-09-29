import { TaskStatsCard } from "@/client/components/task/stats-card";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

interface ExportZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
}

export function ExportZipModal({ isOpen, onClose, task }: ExportZipModalProps) {
  const exportZipMutation = useMutation(
    rpcClient.utils.exportZip.mutationOptions({
      onError: (error: Error) => {
        toast.error("Failed to export task", {
          description: error.message,
        });
      },
      onSuccess: (result) => {
        toast.success("Task exported to Downloads", {
          action: {
            label: showInFolderLabel("file"),
            onClick: () => {
              void showInFolder(result.filepath, { kind: "file" });
            },
          },
          closeButton: true,
          dismissible: true,
          duration: 60_000,
        });
        onClose();
      },
    }),
  );

  const handleExport = () => {
    exportZipMutation.mutate({
      id: task.id,
    });
  };

  return (
    <Dialog onOpenChange={onClose} open={isOpen}>
      <DialogContent maxWidth="28rem">
        <DialogHeader>
          <DialogTitle>Export task</DialogTitle>
          <DialogDescription className="text-left">
            The export will include:
          </DialogDescription>
        </DialogHeader>

        <TaskStatsCard task={task} />

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={exportZipMutation.isPending} onClick={handleExport}>
            {exportZipMutation.isPending ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
