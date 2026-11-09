import { projectDetailsModalAtom } from "@/client/atoms/project-details-modal";
import { chatFiltersAtom } from "@/client/atoms/window";
import { ProjectDialog } from "@/client/components/window/project-dialog";
import { spokenMessage, toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAtom } from "jotai";

/** A project's details, changed or deleted from wherever it was asked for. */
export function ProjectDetailsModal() {
  const [open, setOpen] = useAtom(projectDetailsModalAtom);
  const [filters, setFilters] = useAtom(chatFiltersAtom);
  const queryClient = useQueryClient();
  const projectsQuery = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const projects = projectsQuery.data ?? [];
  // The list leaves out instructions and folders, so the project being
  // changed is read whole, only while its details are open.
  const projectQuery = useQuery(
    rpcClient.workspace.projects.get.queryOptions({
      input: open ? { projectId: open.projectId } : skipToken,
    }),
  );
  const afterProjectChange = {
    onError: (error: Error) => {
      // A name a project can't take comes back in words written for people.
      toast.error("Couldn't change the project", {
        cause: error,
        description: spokenMessage(error, ["BAD_REQUEST"]),
      });
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.projects.key(),
      }),
  };
  const updateProject = useMutation(
    rpcClient.workspace.projects.update.mutationOptions(afterProjectChange),
  );
  const retireProject = useMutation(
    rpcClient.workspace.projects.retire.mutationOptions(afterProjectChange),
  );
  // Read from the query on every render rather than kept, so a re-read
  // after a change does not close the dialog under the user.
  const project = projectQuery.data;
  if (!open || project?.id !== open.projectId) {
    return null;
  }
  return (
    <ProjectDialog
      mode="edit"
      onChange={(edits) => {
        if (Object.keys(edits).length === 0) {
          return;
        }
        updateProject.mutate({ ...edits, projectId: project.id });
      }}
      // Deleting retires the project: the tag goes from the column and from
      // the filter if it was the one chosen; the chats keep everything.
      onDelete={() => {
        retireProject.mutate({ projectId: project.id });
        if (filters.projects.includes(project.id)) {
          setFilters({ ...filters, projects: [] });
        }
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setOpen(null);
        }
      }}
      open
      otherNames={projects.flatMap((each) =>
        each.id === project.id ? [] : [each.name],
      )}
      project={project}
    />
  );
}
