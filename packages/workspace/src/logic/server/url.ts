import { type WorkspaceServerURL } from "@instrument-org/shared";

import { DEFAULT_APPS_SERVER_PORT, LOOPBACK_HOST } from "./constants";

let LAST_PORT: number = DEFAULT_APPS_SERVER_PORT;

export function getWorkspaceServerPort() {
  return LAST_PORT;
}

export function getWorkspaceServerURL() {
  return `http://${LOOPBACK_HOST}:${getWorkspaceServerPort()}` as WorkspaceServerURL;
}

export function setWorkspaceServerPort(port: number) {
  LAST_PORT = port;
}
