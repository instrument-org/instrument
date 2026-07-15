import { APP_NAME_SLUG } from "../constants";

export type WorkspaceServerURL = string & { WorkspaceServerURL: true };
export const SYNTHETIC_MODEL_ID = `${APP_NAME_SLUG}-synthetic`;
export type SyntheticModelId = typeof SYNTHETIC_MODEL_ID;

// Derives a task's dedicated asset origin from the workspace server origin and
// id. Shared so the client (which fetches the origin once) and server agree on
// the exact shape: http://assets.<id>.<host>
export function buildAssetBaseUrl(serverUrl: WorkspaceServerURL, id: string) {
  const { host, protocol } = new URL(serverUrl);
  return `${protocol}//assets.${id}.${host}`;
}
