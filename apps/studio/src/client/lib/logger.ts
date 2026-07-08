import { APP_NAME_SLUG } from "@instrument-org/shared";

import { forwardRendererLog } from "./forward-renderer-logs";

/**
 * A debug logger for the browser that allows for easily filtering in Chrome
 * DevTools.
 */
export const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...msg: any[]) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, no-console
      console.debug(`[${APP_NAME_SLUG}]`, ...msg);
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...error: any[]) => {
    forwardRendererLog("error", error);
    // eslint-disable-next-line no-console, @typescript-eslint/no-unsafe-argument
    console.error(`[${APP_NAME_SLUG}]`, ...error);
  },
};
