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
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export function BranchTaskModal({
  branchPoint,
  isOpen,
  onClose,
  sourceTaskId,
}: {
  branchPoint: { messageId: StoreId.Message; sessionId: StoreId.Session };
  isOpen: boolean;
  onClose: () => void;
  sourceTaskId: TaskId;
}) {
  const { addTab } = useTabActions();

  const branchMutation = useMutation(
    rpcClient.workspace.task.branch.mutationOptions({
      onError: (error: Error) => {
        toast.error("Failed to branch task", {
          description: error.message,
        });
      },
      onSuccess: (branchedTask) => {
        onClose();

        void addTab({
          params: { id: branchedTask.id },
          to: "/tasks/$id",
        });
      },
    }),
  );

  const handleBranch = (e: React.MouseEvent) => {
    e.preventDefault();
    branchMutation.mutate({ branchPoint, sourceTaskId });
  };

  return (
    <AlertDialog onOpenChange={onClose} open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Branch from here?</AlertDialogTitle>
          <AlertDialogDescription>
            Creates a new task with the conversation up to this point and a copy
            of the current files, so you can continue from here without changing
            this task.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={branchMutation.isPending}
            onClick={handleBranch}
          >
            {branchMutation.isPending ? "Branching..." : "Branch"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
