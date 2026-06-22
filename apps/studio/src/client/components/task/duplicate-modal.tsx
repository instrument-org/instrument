import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { TaskStatsCard } from "./stats-card";

export function DuplicateTaskModal({
  isOpen,
  onClose,
  task,
}: {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
}) {
  const { addTab } = useTabActions();

  const duplicateMutation = useMutation(
    rpcClient.workspace.task.duplicate.mutationOptions({
      onError: (error: Error) => {
        toast.error("Failed to duplicate task", {
          description: error.message,
        });
      },
      onSuccess: (duplicatedTask) => {
        onClose();

        void addTab({
          params: { id: duplicatedTask.id },
          to: "/tasks/$id",
        });
      },
    }),
  );

  const handleDuplicate = (e: React.MouseEvent) => {
    e.preventDefault();
    duplicateMutation.mutate({
      keepHistory: true,
      sourceTaskId: task.id,
    });
  };

  return (
    <AlertDialog onOpenChange={onClose} open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicate Task?</AlertDialogTitle>
          <AlertDialogDescription>
            This will create a copy of the task with all of its messages and
            files as a new task.
          </AlertDialogDescription>
          <TaskStatsCard task={task} />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={duplicateMutation.isPending}
            onClick={handleDuplicate}
          >
            {duplicateMutation.isPending ? "Duplicating..." : "Duplicate task"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
