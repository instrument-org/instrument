import { useNavigatedBrowserTargets } from "@/client/hooks/use-browser-targets";
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

// Opens the browser artifact panel once when the selected session's browser
// first starts loading a real page (whether the agent or the user opened it),
// even overriding an artifact panel the user already has open (worth surfacing
// since it's the first time the browser becomes visible). Won't re-open after
// the user closes it, since the guard fires at most once per session for the
// renderer's lifetime.
//
// Keyed on navigation rather than attach because agent-browser creates a page
// for any command that needs one, including commands that only read state it
// turns out not to have. Those used to hijack the panel to show `about:blank`.
export function useAutoOpenBrowserArtifact({
  id,
  selectedSessionId,
}: {
  id: TaskId;
  selectedSessionId: StoreId.Session | undefined;
}) {
  const navigate = useNavigate();

  const navigatedTargets = useNavigatedBrowserTargets();

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
    onTargets(navigatedTargets);
  }, [navigatedTargets]);
}
