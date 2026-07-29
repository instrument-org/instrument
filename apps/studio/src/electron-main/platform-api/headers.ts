import { APP_CLIENT_NAME_STUDIO } from "@instrument-org/shared";
import { app } from "electron";

import { getToken } from "./utils";

export function getPlatformApiHeaders() {
  const token = getToken();
  const baseHeaders = {
    "x-client-arch": process.arch,
    "x-client-name": APP_CLIENT_NAME_STUDIO,
    "x-client-os-version": process.getSystemVersion(),
    "x-client-platform": process.platform,
    "x-client-version": app.getVersion(),
  };
  if (!token) {
    return baseHeaders;
  }
  return {
    ...baseHeaders,
    authorization: `Bearer ${token}`,
  };
}
