import { useAgentBrowserTargets } from "@/client/hooks/use-agent-browser-targets";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

// Opens the browser artifact panel once when the agent first opens a browser
// for the selected session, even overriding an artifact panel the user
// already has open (worth surfacing since it's the first time the agent's
// browser use becomes visible). Won't re-open after the user closes it, since
// the per-target ref guard fires at most once per session.
export function useAutoOpenBrowserArtifact({
  id,
  selectedSessionId,
}: {
  id: TaskId;
  selectedSessionId: StoreId.Session | undefined;
}) {
  const navigate = useNavigate();
  const autoOpenedRef = useRef<BrowserTargetId | undefined>(undefined);

  const attachedTargets = useAgentBrowserTargets();

  const onTargets = useEffectEvent((ids: ReadonlySet<BrowserTargetId>) => {
    if (!selectedSessionId) {
      return;
    }
    const targetId = encodeBrowserTargetId(id, selectedSessionId);
    if (!ids.has(targetId) || autoOpenedRef.current === targetId) {
      return;
    }
    autoOpenedRef.current = targetId;
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
