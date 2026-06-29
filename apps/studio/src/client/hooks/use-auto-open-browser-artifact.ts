import { rpcClient } from "@/client/rpc/client";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

// Opens the browser artifact panel once when the agent first opens a browser
// for the selected session. Won't override an artifact panel the user already
// has open, and won't re-open after the user closes it (per-target ref guard),
// so it never fights the user.
export function useAutoOpenBrowserArtifact({
  artifactPanel,
  id,
  selectedSessionId,
}: {
  artifactPanel: ArtifactPanel | undefined;
  id: TaskId;
  selectedSessionId: StoreId.Session | undefined;
}) {
  const navigate = useNavigate();
  const autoOpenedRef = useRef<string | undefined>(undefined);

  const { data: liveTargetIds } = useQuery(
    rpcClient.workspace.browser.listTargetIds.queryOptions({
      input: selectedSessionId ? { id } : skipToken,
      refetchInterval: 2000,
    }),
  );

  const onTargets = useEffectEvent((ids: string[]) => {
    if (!selectedSessionId) {
      return;
    }
    const targetId = `${id}/${selectedSessionId}`;
    if (
      !ids.includes(targetId) ||
      artifactPanel !== undefined ||
      autoOpenedRef.current === targetId
    ) {
      return;
    }
    autoOpenedRef.current = targetId;
    void navigate({
      from: "/tasks/$id",
      params: { id },
      replace: true,
      search: (search) => ({ ...search, artifactPanel: { type: "browser" } }),
    });
  });

  useEffect(() => {
    if (liveTargetIds) {
      onTargets(liveTargetIds);
    }
  }, [liveTargetIds]);
}
