import { APP_NAME_SLUG } from "@instrument-org/shared";

import { forwardRendererLog } from "./forward-renderer-logs";

/**
 * A debug logger for the browser that allows for easily filtering in Chrome
 * DevTools.
 */
export const logger = {
  debug: (...msg: unknown[]) => {
    if (import.meta.env.DEV) {
      console.debug(`[${APP_NAME_SLUG}]`, ...msg);
    }
  },
  error: (...error: unknown[]) => {
    forwardRendererLog("error", error);
    console.error(`[${APP_NAME_SLUG}]`, ...error);
  },
};
