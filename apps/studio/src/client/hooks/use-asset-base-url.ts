import { buildAssetBaseUrl } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { rpcClient } from "../rpc/client";

// Returns the asset base URL for a task, or "" until the server origin loads.
export function useAssetBaseUrl(taskId: TaskId): string {
  const serverUrl = useWorkspaceServerUrl();
  return serverUrl ? buildAssetBaseUrl(serverUrl, taskId) : "";
}

// The workspace server origin is fixed for the app session, so fetch it once
// and cache it forever. Every task's asset base is derived locally from its id.
function useWorkspaceServerUrl() {
  return useQuery({
    ...rpcClient.workspace.server.url.queryOptions({ input: undefined }),
    gcTime: Infinity,
    staleTime: Infinity,
  }).data;
}
