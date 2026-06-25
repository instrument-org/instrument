import { rpcClient } from "@/client/rpc/client";
import { type ProjectId, type TaskId } from "@instrument-org/workspace/client";

// Must use the overlay (its own WebContentsView): sidebar and tab renderers are
// isolated, so a renderer-local dialog would be clipped to its own view.
export function openCreateProject(taskId?: TaskId) {
  void rpcClient.studioOverlay.show.call({
    kind: "project-modal",
    props: taskId ? { taskId } : undefined,
  });
}

export function openDeleteProject(projectId: ProjectId) {
  void rpcClient.studioOverlay.show.call({
    kind: "delete-project",
    props: { projectId },
  });
}

export function openEditProject(projectId: ProjectId) {
  void rpcClient.studioOverlay.show.call({
    kind: "project-modal",
    props: { projectId },
  });
}
