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

// The browser panel's device-preview menu calls this on every show and on
// every device change; `device: null` clears emulation (also the no-op-safe
// default that self-heals a guest left emulated by a stale session).
const setEmulatedDevice = base
  .input(
    z.object({
      device: z
        .object({
          height: z.number(),
          scale: z.number(),
          width: z.number(),
        })
        .nullable(),
      targetId: BrowserTargetIdSchema,
    }),
  )
  .handler(({ input }) => {
    getBrowserViewManager()?.setEmulatedDevice(input.targetId, input.device);
  });

export const browser = {
  live,
  setEmulatedDevice,
  syncFocus,
};
