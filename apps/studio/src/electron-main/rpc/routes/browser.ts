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
  retryDownload,
} from "@/electron-main/browser-view/download-list";
import { retryDownloadFrom } from "@/electron-main/browser-view/downloads";
import { configureGuestSession } from "@/electron-main/browser-view/guest-session";
import {
  certificateExceptions,
  getBrowserViewManager,
  guestSignIns,
} from "@/electron-main/browser-view/manager";
import {
  allowCapture,
  answerAsk,
  listCaptures,
  pauseCapture,
  reloadCapturePage,
  setSiteCapture,
  stopCapture,
  systemRefusal,
} from "@/electron-main/browser-view/page-capture";
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
import { pageDialogs } from "@/electron-main/browser-view/page-dialogs";
import { suggestSearches } from "@/electron-main/browser-view/search-engine";
import { siteIconDeps } from "@/electron-main/lib/app-protocol";
import { rememberPageIcon as keepPageIcon } from "@/electron-main/lib/site-icons";
import { getWorkspacePreferences } from "@/electron-main/stores/workspace/preferences";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { type BrowserGuestTarget } from "@/shared/browser";
import {
  type BrowserTargetId,
  BrowserTargetIdSchema,
  getBrowserSessionDir,
} from "@instrument-org/workspace/electron";
import { app, nativeTheme } from "electron";
import { z } from "zod";

// Every recorded target and whether its guest has attached yet. The renderer
// pool mounts a `<webview>` for every id (mounting is what triggers the attach);
// the UI derives "live" from `attached`. Single source of truth for both, so
// there's no separate polled endpoint.
function currentTargets(webContentsId: number): BrowserGuestTarget[] {
  return getBrowserViewManager().getTargets(webContentsId);
}

/** Whether what is asked of a guest is for this window, which mounts it. */
function isForHost(webContentsId: number, targetId: BrowserTargetId) {
  return getBrowserViewManager().isHostOf(webContentsId, targetId);
}

const events = {
  focusGuest: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.focus-guest", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  showPage: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.show-page", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  pagePressed: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.page-pressed", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  navigationRefused: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe(
      "browser.navigation-refused",
      { signal },
    )) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  bookmarkLink: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.bookmark-link", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  openInNewTab: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.open-in-new-tab", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  popupChanged: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.popup-changed", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  popupClosed: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.popup-closed", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.openerId)) {
        yield event;
      }
    }
  }),
  pageBecameDownload: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe(
      "browser.page-became-download",
      { signal },
    )) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  restoreHostFocus: base.handler(async function* ({ context, signal }) {
    for await (const { targetId } of publisher.subscribe(
      "browser.restore-host-focus",
      { signal },
    )) {
      if (isForHost(context.webContentsId, targetId)) {
        yield null;
      }
    }
  }),
  // Sizes for parked guests. Replays what is already recorded before streaming
  // changes, so a renderer reload restores every size the model asked for
  // rather than silently reverting its guests to the panel's last bounds.
  setGuestSurface: base.handler(async function* ({ context, signal }) {
    for (const [targetId, size] of getDesiredGuestSurfaces()) {
      if (isForHost(context.webContentsId, targetId)) {
        yield { size, targetId };
      }
    }

    for await (const event of publisher.subscribe("browser.set-guest-surface", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
  stepPage: base.handler(async function* ({ context, signal }) {
    for await (const event of publisher.subscribe("browser.step-page", {
      signal,
    })) {
      if (isForHost(context.webContentsId, event.targetId)) {
        yield event;
      }
    }
  }),
};

const live = {
  // What each tab's page is using of the microphone and camera, or was
  // refused, sent again whenever that changes.
  captures: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("browser.capture-changed", { signal })],
      read: listCaptures,
    });
  }),
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
  // The dialogs tabs' pages are waiting on, oldest first.
  pageDialogs: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [
        publisher.subscribe("browser.page-dialogs-changed", { signal }),
      ],
      read: () => pageDialogs.list(),
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
  targets: base.handler(async function* ({ context, signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("browser.targets-changed", { signal })],
      read: () => currentTargets(context.webContentsId),
    });
  }),
  // The pages other windows have guests for, and whether each shows its page.
  targetsElsewhere: base.handler(async function* ({ context, signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("browser.targets-changed", { signal })],
      read: () =>
        getBrowserViewManager().getTargetsElsewhere(context.webContentsId),
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
  .handler(({ context, input }) => {
    // A window a guest has left can still have word of it on the way, which is
    // no longer its to give.
    if (isForHost(context.webContentsId, input.targetId)) {
      getBrowserViewManager().setGuestShown(input.targetId, input.shown);
    }
  });

// A guest zoomed for the agent's side, whose zoom stays its own rather than
// its site's.
const zoomGuestAlone = base
  .input(
    z.object({
      factor: z.number().positive(),
      targetId: BrowserTargetIdSchema,
    }),
  )
  .handler(({ context, input }) => {
    if (isForHost(context.webContentsId, input.targetId)) {
      getBrowserViewManager().zoomGuestAlone(input.targetId, input.factor);
    }
  });

// A page whose place in its tab's history another guest takes up later keeps
// its history for that guest, named by the target it will come back as.
const keepHistory = base
  .input(
    z.object({
      as: BrowserTargetIdSchema,
      leaving: z.boolean(),
      targetId: BrowserTargetIdSchema,
      url: z.string().min(1),
    }),
  )
  .handler(async ({ context, input }) => {
    if (isForHost(context.webContentsId, input.targetId)) {
      await getBrowserViewManager().keepHistoryFor(input);
    }
  });

// The window's pages it holds only as a step of a tab's history, back or
// forward from what the tab shows, reported whole on each change. Main closes
// one of them that makes sound.
const syncGuestsPutAway = base
  .input(z.object({ targetIds: z.array(BrowserTargetIdSchema) }))
  .handler(({ context, input }) => {
    getBrowserViewManager().setGuestsPutAway(
      context.webContentsId,
      input.targetIds,
    );
  });

const syncHostFocus = base.handler(() => {
  getBrowserViewManager().setHostFocus();
});

// Whether a guest that took the keyboard from its window gives it back: an
// agent's command put it there. The window holds off hearing it lost the
// keyboard while one does.
const returnsKeyboard = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(
    ({ context, input }) =>
      isForHost(context.webContentsId, input.targetId) &&
      getBrowserViewManager().returnsKeyboard(input.targetId),
  );

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
  .handler(({ context, input }) => {
    setRasterBudget(context.webContentsId, input);
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
 * A browser tab's page named its own icons: one is kept for a site the icon
 * service has none for, so a site the person opened draws its mark everywhere.
 */
const rememberPageIcon = base
  .input(z.object({ iconUrls: z.array(z.string()), pageUrl: z.string() }))
  .output(z.object({ stored: z.boolean() }))
  .handler(async ({ input }) => ({
    stored: await keepPageIcon(
      { ...input, theme: nativeTheme.shouldUseDarkColors ? "dark" : "light" },
      siteIconDeps(),
    ),
  }));

/** A page's picture, and the address of the page it shows when known. */
const PagePictureOutput = z.object({
  page: z.string().optional(),
  url: z.string().nullable(),
});

/**
 * A browser tab's page as a picture, for the tiles that stand for it: taken
 * of the guest by its contents id while it is on screen, and read back by the
 * tab's id whenever the tile is drawn, including after a relaunch.
 */
const thumbnails = {
  capture: base
    .input(z.object({ key: z.string(), webContentsId: z.number() }))
    .output(PagePictureOutput)
    .handler(
      async ({ input }) => (await capturePageThumbnail(input)) ?? { url: null },
    ),
  get: base
    .input(z.object({ key: z.string() }))
    .output(PagePictureOutput)
    .handler(
      async ({ input }) =>
        (await readPageThumbnail(input.key)) ?? { url: null },
    ),
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
  /** Downloads a stopped or failed one again, in the in-app browser's session. */
  retry: base.input(z.object({ id: z.string() })).handler(({ input }) => {
    retryDownload(input.id, (url, from) =>
      retryDownloadFrom(
        configureGuestSession(getBrowserSessionDir()),
        url,
        from,
      ),
    );
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
 * A close of these tabs the person asked for: each page among them that asks
 * before it goes is brought up and asked "Leave site?". True to close.
 */
const askBeforeClosingPages = base
  .input(z.object({ targetIds: z.array(BrowserTargetIdSchema) }))
  .handler(({ input }) =>
    getBrowserViewManager().askBeforeClosingPages({
      targetIds: input.targetIds,
    }),
  );

const answerPageDialog = base
  .input(
    z.object({
      answer: z.union([
        z.object({ accept: z.literal(false) }),
        z.object({ accept: z.literal(true), text: z.string().optional() }),
      ]),
      id: z.string(),
    }),
  )
  .handler(({ input }) => {
    pageDialogs.answer(input.id, input.answer);
  });

/**
 * Stop on a page using the microphone or camera: its tracks end, and it
 * needs a fresh click to have them again.
 */
const stopPageCapture = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    stopCapture(input.targetId);
  });

/** Pause or Resume on a page in a call: its tracks stay, sending silence and a black picture while paused. */
const pausePageCapture = base
  .input(z.object({ paused: z.boolean(), targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    pauseCapture(input.targetId, input.paused);
  });

/**
 * The person's answer to a page's ask for the microphone or camera, with the
 * devices they picked in it by name.
 */
const answerPageCapture = base
  .input(
    z.object({
      answer: z.enum(["always", "dismiss", "never", "once"]),
      devices: z.object({
        audio: z.string().optional(),
        video: z.string().optional(),
      }),
      targetId: BrowserTargetIdSchema,
    }),
  )
  .handler(({ input }) => {
    answerAsk(input.targetId, input);
  });

/** What the page's site gets of one device from now on, set from its mark. */
const setPageCaptureSetting = base
  .input(
    z.object({
      setting: z.enum(["allow", "ask", "block"]),
      targetId: BrowserTargetIdSchema,
      type: z.enum(["audio", "video"]),
    }),
  )
  .handler(({ input }) => {
    setSiteCapture(input.targetId, input.type, input.setting);
  });

/**
 * Asks the system for what the ask's preview is about to show, the way a
 * page's grant does: the device it refused the app, or null.
 */
const askSystemForCapture = base
  .input(z.object({ audio: z.boolean(), video: z.boolean() }))
  .output(z.enum(["camera", "microphone"]).nullable())
  .handler(({ input }) =>
    systemRefusal([
      ...(input.audio ? (["audio"] as const) : []),
      ...(input.video ? (["video"] as const) : []),
    ]),
  );

/** Reload on a page refused by its site's settings, after the person changed them. */
const reloadPageForCapture = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    reloadCapturePage(input.targetId);
  });

/**
 * Allow on a page that asked for the microphone or camera with no click to
 * go on: its site may have them in that tab, and the page loads again.
 */
const allowPageCapture = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(({ input }) => {
    allowCapture(input.targetId);
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

/**
 * What each tab's page is marked with, every window's: using the microphone
 * or camera, or not reached. For an agent's list of the tabs; the sidebar
 * hears of each as it changes.
 */
const pageMarks = base.handler(() => ({
  unreached: getBrowserViewManager().unreachedTargets(),
  using: listCaptures().flatMap(({ paused, targetId, using }) =>
    using.audio || using.video
      ? [
          {
            camera: using.video,
            microphone: using.audio,
            paused,
            targetId,
          },
        ]
      : [],
  ),
}));

/**
 * What the search engine would finish words typed into the address field as.
 * From here rather than the renderer, whose page policy keeps every request
 * at home.
 */
const searchSuggestions = base
  .input(z.object({ query: z.string().min(1).max(200) }))
  .output(z.array(z.string()))
  .handler(({ input, signal }) => {
    const preferences = getWorkspacePreferences();
    if (!preferences.get("suggestSearches")) {
      return [];
    }
    return suggestSearches(configureGuestSession(getBrowserSessionDir()), {
      engine: preferences.get("searchEngine"),
      locale: app.getLocale(),
      query: input.query,
      signal,
    });
  });

// A popup's tab, which has no `<webview>`: the window places its view, reads
// its state and drives it through main (`popup-pool.ts`).
const popupInput = z.object({ targetId: BrowserTargetIdSchema });
const popupPage = (webContentsId: number, targetId: BrowserTargetId) =>
  isForHost(webContentsId, targetId)
    ? (getBrowserViewManager().popupOf(targetId)?.page ?? null)
    : null;
const popup = {
  place: base
    .input(
      popupInput.extend({
        bounds: z
          .object({
            height: z.number(),
            width: z.number(),
            x: z.number(),
            y: z.number(),
          })
          .nullable(),
      }),
    )
    .handler(({ context, input }) => {
      if (isForHost(context.webContentsId, input.targetId)) {
        getBrowserViewManager().placePopup(input.targetId, input.bounds);
      }
    }),
  state: base
    .input(popupInput)
    .handler(
      ({ context, input }) =>
        (isForHost(context.webContentsId, input.targetId)
          ? getBrowserViewManager().popupOf(input.targetId)?.state
          : undefined) ?? null,
    ),
  act: base
    .input(
      popupInput.extend({
        act: z.enum([
          "allowSound",
          "back",
          "clearHistory",
          "devTools",
          "forward",
          "print",
          "reload",
          "reloadIgnoringCache",
          "stop",
        ]),
      }),
    )
    .handler(({ context, input }) => {
      const popupContents = popupPage(context.webContentsId, input.targetId);
      if (!popupContents) {
        return;
      }
      const history = popupContents.navigationHistory;
      switch (input.act) {
        case "allowSound": {
          popupContents.setAudioMuted(false);
          return;
        }
        case "back": {
          history.goBack();
          return;
        }
        case "clearHistory": {
          history.clear();
          return;
        }
        case "devTools": {
          popupContents.openDevTools({ mode: "detach" });
          return;
        }
        case "forward": {
          history.goForward();
          return;
        }
        case "print": {
          popupContents.print();
          return;
        }
        case "reload": {
          popupContents.reload();
          return;
        }
        case "reloadIgnoringCache": {
          popupContents.reloadIgnoringCache();
          return;
        }
        case "stop": {
          popupContents.stop();
          return;
        }
      }
    }),
  load: base
    .input(popupInput.extend({ url: z.string() }))
    .handler(async ({ context, input }) => {
      await popupPage(context.webContentsId, input.targetId)?.loadURL(
        input.url,
      );
    }),
  run: base
    .input(popupInput.extend({ code: z.string() }))
    .handler(
      async ({ context, input }): Promise<unknown> =>
        popupPage(context.webContentsId, input.targetId)?.executeJavaScript(
          input.code,
        ),
    ),
  find: base
    .input(
      popupInput.extend({
        findNext: z.boolean().optional(),
        forward: z.boolean().optional(),
        text: z.string(),
      }),
    )
    .handler(({ context, input }) => {
      const { findNext, forward, targetId, text } = input;
      popupPage(context.webContentsId, targetId)?.findInPage(text, {
        ...(findNext === undefined ? {} : { findNext }),
        ...(forward === undefined ? {} : { forward }),
      });
    }),
  stopFind: base
    .input(
      popupInput.extend({
        action: z.enum([
          "activateSelection",
          "clearSelection",
          "keepSelection",
        ]),
      }),
    )
    .handler(({ context, input }) => {
      popupPage(context.webContentsId, input.targetId)?.stopFindInPage(
        input.action,
      );
    }),
  setZoom: base
    .input(popupInput.extend({ factor: z.number().positive() }))
    .handler(({ context, input }) => {
      popupPage(context.webContentsId, input.targetId)?.setZoomFactor(
        input.factor,
      );
    }),
  capture: base.input(popupInput).handler(async ({ context, input }) => {
    const popupContents = popupPage(context.webContentsId, input.targetId);
    if (!popupContents) {
      return null;
    }
    const image = await popupContents.capturePage(undefined, {
      stayHidden: true,
    });
    return image.isEmpty() ? null : image.toDataURL();
  }),
};

export const browser = {
  allowPageCapture,
  answerPageCapture,
  answerPageDialog,
  answerSignIn,
  askBeforeClosingPages,
  askSystemForCapture,
  continueDespiteCertificate,
  pausePageCapture,
  reloadPageForCapture,
  setPageCaptureSetting,
  stopPageCapture,
  downloads,
  events,
  lastLoad,
  live,
  page,
  pageMarks,
  popup,
  rememberPageIcon,
  searchSuggestions,
  setEmulatedDevice,
  syncFocus,
  syncGuestShown,
  zoomGuestAlone,
  keepHistory,
  syncGuestsPutAway,
  syncGuestSurface,
  returnsKeyboard,
  syncHostFocus,
  syncRasterBudget,
  thumbnails,
};
