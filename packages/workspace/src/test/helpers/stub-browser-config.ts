import { noop } from "radashi";

import { type BrowserConfig } from "../../types";

/**
 * A browser with no guest ever live, for code that runs a workspace without
 * one. Apart from the other test helpers so a script's stub config reaches
 * none of their test-only environment.
 */
export function createStubBrowserConfig(): BrowserConfig {
  return {
    closeTarget: () => Promise.resolve(),
    createTarget: () => Promise.resolve(),
    contentBlocking: () => ({ task: true, workspace: true }),
    getTargetMeta: () => null,
    hasNoWindow: false,
    isGuestAsleep: () => false,
    isGuestBusy: () => false,
    getTargetUrl: (): string | undefined => {
      // No guest is ever live here, so there is no address to report.
      return;
    },
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: () => noop,
    sendCommand: () => Promise.resolve({}),
    setAgentFileRoots: noop,
    sleepGuest: noop,
    stopScreencast: noop,
    subscribeEvents: () => noop,
  };
}
