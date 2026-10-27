import { liveRead } from "@instrument-org/workspace/electron";
import {
  getDesiredGuestSurfaces,
  recordEffectiveGuestSurface,
  setRasterBudget,
} from "@/electron-main/browser-view/guest-surface";
import {
  cancelDownload,
  clearDownloads,
  listDownloads,
  removeDownload,
} from "@/electron-main/browser-view/download-list";
import {
  certificateExceptions,
  getBrowserViewManager,
  guestSignIns,
} from "@/electron-main/browser-view/manager";
import {
  savePageAs,
  sharePage,
} from "@/electron-main/browser-view/page-actions";
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
import { app } from "electron";
import { z } from "zod";

// Every recorded target and whether its guest has attached yet. The renderer
// pool mounts a `<webview>` for every id (mounting is what triggers the attach);
// the UI derives "live" from `attached`. Single source of truth for both, so
// there's no separate polled endpoint.
function currentTargets(): BrowserGuestTarget[] {
  return getBrowserViewManager().getTargets();
}

const events = {
  focusGuest: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("browser.focus-guest", {
      signal,
    })) {
      yield event;
    }
  }),
  navigationRefused: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe(
      "browser.navigation-refused",
      { signal },
    )) {
      yield event;
    }
  }),
  openInNewTab: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("browser.open-in-new-tab", {
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
  stepPage: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("browser.step-page", {
      signal,
    })) {
      yield event;
    }
  }),
};

const live = {
  // The sites with a certificate a person trusted anyway this run.
  certificateExceptions: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [
        publisher.subscribe("browser.certificate-exceptions-changed", {
          signal,
        }),
      ],
      read: () => certificateExceptions.hosts(),
    });
  }),
  // The download list, newest first, sent again whenever it changes.
  downloads: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("browser.downloads-changed", { signal })],
      read: listDownloads,
    });
  }),
  // The sign-ins tabs' pages are waiting on, oldest first.
  signIns: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("browser.sign-ins-changed", { signal })],
      read: () => guestSignIns.list(),
    });
  }),
  // Stream the browser targets. The renderer pool reconciles its guests to this
  // set (mount on add, dispose on remove) and the UI reads `attached`.
  // Re-subscribing always yields the current set, so nothing is stranded by a
  // change that happened before the listener existed.
  targets: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("browser.targets-changed", { signal })],
      read: currentTargets,
    });
  }),
};

// Real DOM focus/blur on a guest's `<webview>` element, reported by the
// renderer pool. Electron's WebContents#isFocused() is unreliable for
// `<webview>` guests, so keyboard commands (zoom, back/forward) trust this
// instead of asking the guest directly.
const syncFocus = base
  .input(z.object({ focused: z.boolean(), targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    getBrowserViewManager().setGuestFocus(input.targetId, input.focused);
  });

// Whether a slot shows a guest or the pool parks it, reported by the pool on
// each change. Main grants a page full screen only in a shown guest.
const syncGuestShown = base
  .input(z.object({ shown: z.boolean(), targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    getBrowserViewManager().setGuestShown(input.targetId, input.shown);
  });

const syncHostFocus = base.handler(() => {
  getBrowserViewManager().setHostFocus();
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
    getBrowserViewManager().setEmulatedDevice(input.targetId, input.device);
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

/** What a person can do to a download on the browser's list. */
const downloads = {
  cancel: base.input(z.object({ id: z.string() })).handler(({ input }) => {
    cancelDownload(input.id);
  }),
  clear: base.handler(() => {
    clearDownloads();
  }),
  remove: base.input(z.object({ id: z.string() })).handler(({ input }) => {
    removeDownload(input.id);
  }),
};

/** What a page's menu asks of the main process. */
const page = {
  /** Asks where, then saves the page, by its guest's contents id. */
  saveAs: base
    .input(z.object({ webContentsId: z.number() }))
    .handler(({ context, input }) =>
      savePageAs({
        callerId: context.webContentsId,
        webContentsId: input.webContentsId,
      }),
    ),
  /** False where the system has no share menu (off the Mac). */
  share: base
    .input(z.object({ url: z.string().min(1) }))
    .output(z.object({ shown: z.boolean() }))
    .handler(({ context, input }) => ({
      shown: sharePage({ callerId: context.webContentsId, url: input.url }),
    })),
};

/**
 * The person's answer to a page's sign-in: what they typed, or null for
 * Cancel. Handed to Chromium and kept nowhere else.
 */
const answerSignIn = base
  .input(
    z.object({
      credentials: z
        .object({ password: z.string(), username: z.string() })
        .nullable(),
      id: z.string(),
    }),
  )
  .handler(({ input }) => {
    guestSignIns.answer(input.id, input.credentials);
  });

/**
 * "Continue" on a page refused for its certificate: trusts that certificate
 * for its site until the app quits and loads the page again.
 */
const continueDespiteCertificate = base
  .input(z.object({ targetId: BrowserTargetIdSchema, url: z.string() }))
  .output(z.object({ continued: z.boolean() }))
  .handler(({ input }) => ({
    continued: getBrowserViewManager().continueDespiteCertificate(
      input.targetId,
      input.url,
    ),
  }));

/**
 * How a tab's last page load ended, read by its panel once it is listening,
 * since a first load can fail before then.
 */
const lastLoad = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => getBrowserViewManager().lastLoadOf(input.targetId));

/** The engine's answer: the words asked about, then what it would finish them as. */
const SuggestionsSchema = z.tuple(
  [z.string(), z.array(z.string())],
  z.unknown(),
);

/**
 * What the search engine would finish words typed into the address field as,
 * asked the way a browser's own field asks it. From here rather than the
 * renderer, whose page policy keeps every request at home. A slow or failed
 * answer is no suggestions: the field still searches for what was typed.
 */
const searchSuggestions = base
  .input(z.object({ query: z.string().min(1).max(200) }))
  .output(z.array(z.string()))
  .handler(async ({ input, signal }) => {
    const url = new URL("https://duckduckgo.com/ac/");
    url.searchParams.set("kl", duckDuckGoRegion(app.getLocale()));
    url.searchParams.set("q", input.query);
    url.searchParams.set("type", "list");
    const timeout = AbortSignal.timeout(3000);
    try {
      const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        return [];
      }
      const body = SuggestionsSchema.safeParse(await response.json());
      return body.success ? body.data[1] : [];
    } catch {
      return [];
    }
  });

/**
 * The engine's region code for a locale, `en-US` as `us-en`; `wt-wt` (no
 * region) when the locale names no country.
 */
function duckDuckGoRegion(locale: string) {
  const [language, country] = locale.toLowerCase().split(/[-_]/);
  return language && country ? `${country}-${language}` : "wt-wt";
}

export const browser = {
  answerSignIn,
  continueDespiteCertificate,
  downloads,
  events,
  lastLoad,
  live,
  page,
  rememberPageIcon,
  searchSuggestions,
  setEmulatedDevice,
  syncFocus,
  syncGuestShown,
  syncGuestSurface,
  syncHostFocus,
  syncRasterBudget,
  thumbnails,
};
