import { type StoreId } from "@instrument-org/workspace/client";

export function shouldAutoOpenOutputArtifact({
  eventSessionId,
  fileCount,
  selectedSessionId,
}: {
  eventSessionId: StoreId.Session;
  fileCount: number;
  selectedSessionId: StoreId.Session | undefined;
}) {
  return eventSessionId === selectedSessionId && fileCount > 0;
}
