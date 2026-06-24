import { rpcClient } from "@/client/rpc/client";

// Opens the New Project modal as an app-wide studio overlay. Must go through the
// overlay (its own WebContentsView) rather than an in-renderer dialog: the
// sidebar and each tab are separate web contents, so a renderer-mounted dialog
// can't be opened from a different renderer and would be clipped to its own view.
export function openCreateProject() {
  void rpcClient.studioOverlay.show.call({ kind: "new-project" });
}
