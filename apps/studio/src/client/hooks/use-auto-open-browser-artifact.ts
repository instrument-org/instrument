import { useAgentBrowserTargets } from "@/client/hooks/use-agent-browser-targets";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

// Targets already auto-opened this renderer session. Module-scoped (not per
// mount) so reopening the task's tab doesn't re-hijack the artifact panel for a
// browser the user already dismissed.
const autoOpenedTargets = new Set<BrowserTargetId>();

// Opens the browser artifact panel once when the agent first opens a browser
// for the selected session, even overriding an artifact panel the user
// already has open (worth surfacing since it's the first time the agent's
// browser use becomes visible). Won't re-open after the user closes it, since
// the guard fires at most once per session for the renderer's lifetime.
export function useAutoOpenBrowserArtifact({
  id,
  selectedSessionId,
}: {
  id: TaskId;
  selectedSessionId: StoreId.Session | undefined;
}) {
  const navigate = useNavigate();

  const attachedTargets = useAgentBrowserTargets();

  const onTargets = useEffectEvent((ids: ReadonlySet<BrowserTargetId>) => {
    if (!selectedSessionId) {
      return;
    }
    const targetId = encodeBrowserTargetId(id, selectedSessionId);
    if (!ids.has(targetId) || autoOpenedTargets.has(targetId)) {
      return;
    }
    autoOpenedTargets.add(targetId);
    void navigate({
      from: "/tasks/$id/",
      params: { id },
      replace: true,
      search: (search) => ({ ...search, artifactPanel: { type: "browser" } }),
    });
  });

  useEffect(() => {
    onTargets(attachedTargets);
  }, [attachedTargets]);
}
