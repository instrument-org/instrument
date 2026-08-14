import { type WorkspaceServerURL } from "@instrument-org/shared";

import {
  DEFAULT_APPS_SERVER_PORT,
  LOCALHOST_APPS_SERVER_DOMAIN,
} from "./constants";

let LAST_PORT: number = DEFAULT_APPS_SERVER_PORT;

export function getWorkspaceServerPort() {
  return LAST_PORT;
}

export function getWorkspaceServerURL() {
  return `http://${LOCALHOST_APPS_SERVER_DOMAIN}:${getWorkspaceServerPort()}` as WorkspaceServerURL;
}

export function setWorkspaceServerPort(port: number) {
  LAST_PORT = port;
}
