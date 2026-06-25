import { Button } from "@/client/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { rpcClient } from "@/client/rpc/client";
import { StudioOverlayDeleteProjectSearchSchema } from "@/shared/studio-overlay";
import { ProjectIdSchema } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/studio-overlay/delete-project")({
  component: DeleteProjectModal,
  validateSearch: StudioOverlayDeleteProjectSearchSchema,
});

function DeleteProjectModal() {
  const { projectId } = Route.useSearch();
  const id = ProjectIdSchema.parse(projectId);

  const { data: project } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({ input: { id } }),
  );

  const { isPending, mutateAsync: removeProject } = useMutation(
    rpcClient.workspace.project.remove.mutationOptions({
      onError: (error) => {
        toast.error("Failed to delete project", { description: error.message });
      },
    }),
  );

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          Delete {project ? `"${project.name}"` : "project"}?
        </DialogTitle>
        <DialogDescription>
          The project will be moved to your system trash. Its tasks are kept and
          simply removed from the project.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          disabled={isPending}
          onClick={() => {
            void rpcClient.studioOverlay.dismiss.call();
          }}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={isPending}
          onClick={async () => {
            await removeProject({ id });
            void rpcClient.studioOverlay.resolve.call();
          }}
          variant="destructive"
        >
          Delete project
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
