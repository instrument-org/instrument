import {
  LOCAL_LOOPBACK_APPS_SERVER_DOMAIN,
  LOCALHOST_APPS_SERVER_DOMAIN,
} from "../logic/server/constants";
import { getWorkspaceServerPort } from "../logic/server/url";
import { type TaskId } from "../schemas/task-id";

export function localhostUrl(id: TaskId) {
  return `http://${id}.${LOCALHOST_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}`;
}

export function loopbackUrl(id: TaskId) {
  return `http://${id}.${LOCAL_LOOPBACK_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}`;
}
