import { rpcClient } from "@/client/rpc/client";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

// Focuses the first output/ artifact a run produced, per the server's
// outputArtifacts event stream. useEffectEvent reads current state
// non-reactively, so the effect fires once per event, never re-opening one.
export function useAutoOpenOutputArtifact({
  artifactPanel,
  selectedSessionId,
  subdomain,
}: {
  artifactPanel: ArtifactPanel | undefined;
  selectedSessionId: StoreId.Session | undefined;
  subdomain: TaskId;
}) {
  const navigate = useNavigate();

  const { data: artifacts } = useQuery(
    rpcClient.workspace.task.live.outputArtifacts.experimental_liveOptions({
      input: { subdomain },
    }),
  );

  const onArtifacts = useEffectEvent((event: NonNullable<typeof artifacts>) => {
    const file = event.files[0];
    if (
      event.sessionId !== selectedSessionId ||
      artifactPanel !== undefined ||
      !file
    ) {
      return;
    }

    void navigate({
      from: "/tasks/$id",
      params: { id: subdomain },
      replace: true,
      search: (s) => ({
        ...s,
        artifactPanel: {
          filePath: file.filePath,
          modifiedAt: file.modifiedAt,
          type: "file",
        },
      }),
    });
  });

  useEffect(() => {
    if (artifacts) {
      onArtifacts(artifacts);
    }
  }, [artifacts]);
}
