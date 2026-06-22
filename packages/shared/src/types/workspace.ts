import { APP_NAME_SLUG } from "../constants";

export type WorkspaceServerURL = string & { WorkspaceServerURL: true };
export const SYNTHETIC_MODEL_ID = `${APP_NAME_SLUG}-synthetic`;
export type SyntheticModelId = typeof SYNTHETIC_MODEL_ID;

// Derives a task's asset base URL from the workspace server origin and id.
// Shared so the client (which fetches the origin once) and server agree on the
// exact shape: http://<id>.<host>/_<slug>/assets
export function buildAssetBaseUrl(serverUrl: WorkspaceServerURL, id: string) {
  const { host, protocol } = new URL(serverUrl);
  return `${protocol}//${id}.${host}/_${APP_NAME_SLUG}/assets`;
}
