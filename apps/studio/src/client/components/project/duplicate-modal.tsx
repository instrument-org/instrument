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

import { ProjectStatsCard } from "./stats-card";

export function DuplicateProjectModal({
  isOpen,
  onClose,
  project,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: Task;
}) {
  const { addTab } = useTabActions();

  const duplicateMutation = useMutation(
    rpcClient.workspace.project.duplicate.mutationOptions({
      onError: (error: Error) => {
        toast.error("Failed to duplicate task", {
          description: error.message,
        });
      },
      onSuccess: (duplicatedProject) => {
        onClose();

        void addTab({
          params: { subdomain: duplicatedProject.subdomain },
          to: "/projects/$subdomain",
        });
      },
    }),
  );

  const handleDuplicate = (e: React.MouseEvent) => {
    e.preventDefault();
    duplicateMutation.mutate({
      keepHistory: true,
      sourceSubdomain: project.subdomain,
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
          <ProjectStatsCard project={project} />
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
