import {
  buildAssetBaseUrl,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";

import { rpcClient } from "../rpc/client";
import { captureException } from "./telemetry";

// The workspace server origin is fixed for the app session. Resolved once at
// boot (see app.tsx) into this module so asset URLs derive synchronously from a
// task id, with no React/hook dependency -- usable anywhere (render, memos,
// plain functions, event handlers). Single seam: if the origin is ever injected
// at boot instead (e.g. cloud-hosted), only this resolution changes.
let workspaceServerUrl: undefined | WorkspaceServerURL;

// Returns a task's asset base URL. "" only in the should-never-happen window
// before resolveWorkspaceServerUrl() completes (or if it failed, which is
// already loudly reported). Consumers get a harmless best-effort string and
// never have to reason about loading.
export function getAssetBaseUrl(taskId: TaskId): string {
  return workspaceServerUrl
    ? buildAssetBaseUrl(workspaceServerUrl, taskId)
    : "";
}

export async function resolveWorkspaceServerUrl() {
  const [error, data] = await safe(rpcClient.workspace.server.url.call());
  if (error) {
    captureException(
      new Error("Failed to resolve workspace server origin at boot", {
        cause: error,
      }),
    );
    return;
  }
  workspaceServerUrl = data;
}
