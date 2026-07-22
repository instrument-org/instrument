import { type ClientInfo } from "../types";

// Forward the desktop client's non-identifying metadata to our own gateway so
// backend analytics and logs can slice by app version, OS, and CPU arch. The
// caller gates this on our provider so a user's own provider key never carries
// it.
export function setClientHeaders(headers: Headers, clientInfo: ClientInfo) {
  headers.set("x-client-name", clientInfo.clientName);
  headers.set("x-client-version", clientInfo.clientVersion);
  headers.set("x-client-platform", clientInfo.clientPlatform);
  headers.set("x-client-arch", clientInfo.clientArch);
}
