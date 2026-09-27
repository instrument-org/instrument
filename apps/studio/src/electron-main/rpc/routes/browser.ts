import {
  getDesiredGuestSurfaces,
  recordEffectiveGuestSurface,
  setRasterBudget,
} from "@/electron-main/browser-view/guest-surface";
import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import {
  capturePageThumbnail,
  forgetPageThumbnails,
  keepOnlyPageThumbnails,
  readPageThumbnail,
} from "@/electron-main/browser-view/page-thumbnails";
import { siteIconDeps } from "@/electron-main/lib/app-protocol";
import { rememberPageIcon as keepPageIcon } from "@/electron-main/lib/site-icons";
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

const events = {
  downloadFinished: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("browser.download-finished", {
      signal,
    })) {
      yield event;
    }
  }),
  focusGuest: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("browser.focus-guest", {
      signal,
    })) {
      yield event;
    }
  }),
  restoreHostFocus: base.handler(async function* ({ signal }) {
    for await (const _ of publisher.subscribe("browser.restore-host-focus", {
      signal,
    })) {
      yield null;
    }
  }),
  // Sizes for parked guests. Replays what is already recorded before streaming
  // changes, so a renderer reload restores every size the model asked for
  // rather than silently reverting its guests to the panel's last bounds.
  setGuestSurface: base.handler(async function* ({ signal }) {
    for (const [targetId, size] of getDesiredGuestSurfaces()) {
      yield { size, targetId };
    }

    for await (const event of publisher.subscribe("browser.set-guest-surface", {
      signal,
    })) {
      yield event;
    }
  }),
};

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

const syncHostFocus = base.handler(() => {
  getBrowserViewManager()?.setHostFocus();
});

// The size the pool actually applied to a parked guest. Reported whenever it
// changes, so main can answer a window-dimension probe with what the guest has
// rather than what was last asked for -- the two diverge when the window shrinks
// under a granted size and the pool clamps to what it can rasterize.
const syncGuestSurface = base
  .input(
    z.object({
      height: z.number(),
      targetId: BrowserTargetIdSchema,
      width: z.number(),
    }),
  )
  .handler(({ input }) => {
    recordEffectiveGuestSurface({
      size: { height: input.height, width: input.width },
      targetId: input.targetId,
    });
  });

// How large a guest this window can rasterize in full, reported by the pool on
// startup and on every window resize. Main has no way to measure it and needs it
// to answer an agent asking for a viewport.
const syncRasterBudget = base
  .input(z.object({ height: z.number(), width: z.number() }))
  .handler(({ input }) => {
    setRasterBudget(input);
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

/**
 * A browser tab's page named its own icon: kept for its site when the favicon
 * proxy has none, so a site the person opened draws its real mark everywhere.
 */
const rememberPageIcon = base
  .input(z.object({ iconUrl: z.string(), pageUrl: z.string() }))
  .output(z.object({ stored: z.boolean() }))
  .handler(async ({ input }) => ({
    stored: await keepPageIcon(input, siteIconDeps()),
  }));

/**
 * A browser tab's page as a picture, for the tiles that stand for it: taken
 * of the guest by its contents id while it is on screen, and read back by the
 * tab's id whenever the tile is drawn, including after a relaunch.
 */
const thumbnails = {
  capture: base
    .input(z.object({ key: z.string(), webContentsId: z.number() }))
    .output(z.object({ url: z.string().nullable() }))
    .handler(async ({ input }) => ({
      url: await capturePageThumbnail(input),
    })),
  get: base
    .input(z.object({ key: z.string() }))
    .output(z.object({ url: z.string().nullable() }))
    .handler(async ({ input }) => ({
      url: await readPageThumbnail(input.key),
    })),
  /** The pictures of tabs that are gone, a closed tab's or a trashed chat's. */
  forget: base
    .input(z.object({ keys: z.array(z.string()) }))
    .handler(async ({ input }) => {
      await forgetPageThumbnails(input.keys);
    }),
  /** Every picture but those of the tabs the window holds, at startup. */
  keepOnly: base
    .input(z.object({ keys: z.array(z.string()) }))
    .handler(async ({ input }) => {
      await keepOnlyPageThumbnails(input.keys);
    }),
};

export const browser = {
  events,
  live,
  rememberPageIcon,
  setEmulatedDevice,
  syncFocus,
  syncGuestSurface,
  syncHostFocus,
  syncRasterBudget,
  thumbnails,
};
