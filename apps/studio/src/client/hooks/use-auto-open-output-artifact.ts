import { rpcClient } from "@/client/rpc/client";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import {
  type ProjectSubdomain,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

// Focuses the first output/ artifact a run produced, per the server's
// outputArtifacts event stream. useEffectEvent reads current state
// non-reactively, so the effect fires once per event, never re-opening one.
export function useAutoOpenOutputArtifact({
  artifactPanel,
  hasAppModifications,
  selectedSessionId,
  subdomain,
}: {
  artifactPanel: ArtifactPanel | undefined;
  hasAppModifications: boolean | undefined;
  selectedSessionId: StoreId.Session | undefined;
  subdomain: ProjectSubdomain;
}) {
  const navigate = useNavigate();

  const { data: artifacts } = useQuery(
    rpcClient.workspace.project.live.outputArtifacts.experimental_liveOptions({
      input: { subdomain },
    }),
  );

  const onArtifacts = useEffectEvent((event: NonNullable<typeof artifacts>) => {
    const filePath = event.filePaths[0];
    if (
      event.sessionId !== selectedSessionId ||
      hasAppModifications !== false ||
      artifactPanel !== undefined ||
      !filePath
    ) {
      return;
    }

    void navigate({
      from: "/projects/$subdomain",
      params: { subdomain },
      replace: true,
      search: (s) => ({
        ...s,
        artifactPanel: { filePath, fileVersion: event.commitRef, type: "file" },
      }),
    });
  });

  useEffect(() => {
    if (artifacts) {
      onArtifacts(artifacts);
    }
  }, [artifacts]);
}
