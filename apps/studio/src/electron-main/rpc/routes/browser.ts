import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { type BrowserGuestTarget } from "@/shared/browser";
import { BrowserTargetIdSchema } from "@instrument-org/workspace/electron";
import { z } from "zod";

// Every recorded target and whether its guest has attached yet. The renderer
// pool mounts a `<webview>` for every id (mounting is what triggers the attach);
// the UI derives "live" from `attached`. Single source of truth for both, so
// there's no separate polled endpoint.
function currentTargets(): BrowserGuestTarget[] {
  return getBrowserViewManager()?.getTargets() ?? [];
}

const live = {
  // Stream the browser targets. The renderer pool reconciles its guests to this
  // set (mount on add, dispose on remove) and the UI reads `attached`.
  // Re-subscribing always yields the current set, so nothing is stranded by a
  // change that happened before the listener existed.
  targets: base.handler(async function* ({ signal }) {
    yield currentTargets();

    for await (const _ of publisher.subscribe("browser.targets-changed", {
      signal,
    })) {
      yield currentTargets();
    }
  }),
};

// Real DOM focus/blur on a guest's `<webview>` element, reported by the
// renderer pool. Electron's WebContents#isFocused() is unreliable for
// `<webview>` guests, so keyboard commands (zoom, back/forward) trust this
// instead of asking the guest directly.
const syncFocus = base
  .input(z.object({ focused: z.boolean(), targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    getBrowserViewManager()?.setGuestFocus(input.targetId, input.focused);
  });

// Defensive reset the renderer calls whenever a panel takes a guest visible
// again, clearing any Emulation.setDeviceMetricsOverride an agent session left
// active (no-op if none is active). See resetGuestViewport in manager.ts.
const resetViewport = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    getBrowserViewManager()?.resetGuestViewport(input.targetId);
  });

export const browser = {
  live,
  resetViewport,
  syncFocus,
};
