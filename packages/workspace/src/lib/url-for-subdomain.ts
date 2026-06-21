import {
  APPS_SERVER_API_PATH,
  LOCAL_LOOPBACK_APPS_SERVER_DOMAIN,
  LOCALHOST_APPS_SERVER_DOMAIN,
} from "../logic/server/constants";
import { getWorkspaceServerPort } from "../logic/server/url";
import { type TaskId } from "../schemas/task-id";

export function localhostUrl(subdomain: TaskId) {
  return `http://${subdomain}.${LOCALHOST_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}`;
}

export function loopbackUrl(subdomain: TaskId) {
  return `http://${subdomain}.${LOCAL_LOOPBACK_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}`;
}

export function urlsForSubdomain(subdomain: TaskId) {
  return {
    assetBase: assetBaseUrl(subdomain),
    localhost: localhostUrl(subdomain),
    loopback: loopbackUrl(subdomain),
  };
}

function assetBaseUrl(subdomain: TaskId) {
  return `${localhostUrl(subdomain)}${APPS_SERVER_API_PATH}/assets`;
}
