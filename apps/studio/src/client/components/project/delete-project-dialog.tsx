import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export function DeleteProjectDialog({
  onOpenChange,
  open,
  projectId,
  projectName,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId: ProjectId;
  projectName: string;
}) {
  useBlockTabNavigation(open);

  const { isPending, mutateAsync: removeProject } = useMutation(
    rpcClient.workspace.project.remove.mutationOptions({
      onError: (error) => {
        toast.error("Failed to delete project", { description: error.message });
      },
    }),
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent maxWidth="28rem">
        <DialogHeader>
          <DialogTitle>Delete {`“${projectName}”`}?</DialogTitle>
          <DialogDescription>
            The project will be moved to your system trash. Its tasks are kept
            and simply removed from the project.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={isPending}
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={async () => {
              const [error] = await safe(removeProject({ id: projectId }));
              if (!error) {
                onOpenChange(false);
              }
            }}
            variant="destructive"
          >
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
