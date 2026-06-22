import { type WorkspaceServerURL } from "@instrument-org/shared";
import { z } from "zod";

import { getWorkspaceServerURL } from "../../logic/server/url";
import { base } from "../base";

// The workspace server origin (http://localhost:<port>). Stable for the app
// session, so the client fetches it once and derives per-task asset URLs
// locally via buildAssetBaseUrl. If the server ever reboots on a new port,
// this can become a live endpoint and all consumers update automatically.
const url = base
  .input(z.void())
  .output(z.custom<WorkspaceServerURL>((value) => typeof value === "string"))
  .handler(() => getWorkspaceServerURL());

export const server = {
  url,
};
