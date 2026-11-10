import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { projectOfLink } from "@instrument-org/shared";

/**
 * Opens the details of the project a link names, by its id or its name.
 * A project since retired or never made opens nothing and says so.
 */
export async function showProject(name: string) {
  const [error, projects] = await safe(
    rpcClient.workspace.projects.list.call(),
  );
  if (error) {
    toast.error("Couldn't open the project", { cause: error });
    return;
  }
  const project = projectOfLink(projects, name);
  if (!project) {
    toast("No project at that address", {
      description:
        "It may have been deleted, or the link is for another workspace.",
    });
    return;
  }
  openProjectDetails(project.id);
}
