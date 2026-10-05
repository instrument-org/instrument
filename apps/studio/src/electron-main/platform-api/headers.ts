import { APP_CLIENT_NAME_STUDIO } from "@instrument-org/shared";
import { app } from "electron";

import { getToken } from "./utils";

/**
 * What the app says about itself on a request that needs no account: which
 * build, on which platform. Public setup routes get only these, so a signed-in
 * user's fetch of them stays unlinked to the account.
 */
export function getAnonymousPlatformApiHeaders() {
  return {
    "user-agent": `Instrument/${app.getVersion()} (${process.platform}; ${process.arch})`,
    "x-client-arch": process.arch,
    "x-client-name": APP_CLIENT_NAME_STUDIO,
    "x-client-os-version": process.getSystemVersion(),
    "x-client-platform": process.platform,
    "x-client-version": app.getVersion(),
  };
}

export function getPlatformApiHeaders() {
  const token = getToken();
  const baseHeaders = getAnonymousPlatformApiHeaders();
  if (!token) {
    return baseHeaders;
  }
  return {
    ...baseHeaders,
    authorization: `Bearer ${token}`,
  };
}
