import {
  APPS_SERVER_API_PATH,
  LOCAL_LOOPBACK_APPS_SERVER_DOMAIN,
  LOCALHOST_APPS_SERVER_DOMAIN,
} from "../logic/server/constants";
import { getWorkspaceServerPort } from "../logic/server/url";
import { type TaskId } from "../schemas/task-id";

export function assetBaseUrl(id: TaskId) {
  return `${localhostUrl(id)}${APPS_SERVER_API_PATH}/assets`;
}

export function localhostUrl(id: TaskId) {
  return `http://${id}.${LOCALHOST_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}`;
}

export function loopbackUrl(id: TaskId) {
  return `http://${id}.${LOCAL_LOOPBACK_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}`;
}
