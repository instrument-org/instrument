import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";

// Opens the New Project modal as an app-wide studio overlay. Must go through the
// overlay (its own WebContentsView) rather than an in-renderer dialog: the
// sidebar and each tab are separate web contents, so a renderer-mounted dialog
// can't be opened from a different renderer and would be clipped to its own view.
//
// Pass a taskId when opening from a task's "Add to project" so the task gets
// filed into the project once it's created (shuttled via the overlay's search).
export function openCreateProject(taskId?: TaskId) {
  void rpcClient.studioOverlay.show.call({
    kind: "new-project",
    props: taskId ? { taskId } : undefined,
  });
}
