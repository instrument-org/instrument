import { type BrowserHost } from "@instrument-org/workspace/client";

/**
 * Which window this renderer is, as the browser manager names hosts: the pool
 * mounts only the guests meant for this window, and a browser opened from
 * here is opened for it.
 */
export const WINDOW_BROWSER_HOST: BrowserHost =
  window.api.windowType === "orchestrator" ? "orchestrator" : "main";
