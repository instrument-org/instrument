import { historyToRestore } from "@/electron-main/browser-view/guest-history";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  type BrowserGuestTarget,
  type GuestLastLoad,
  targetIdFromPartition,
} from "@/shared/browser";
import {
  type AbsolutePath,
  type BrowserConfig,
  type BrowserTarget,
  type BrowserTargetId,
  lastBrowserAgentActivity,
} from "@instrument-org/workspace/electron";
import {
  BrowserWindow,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";
import { noop } from "radashi";

import { applyProductBrandedMetadata } from "../lib/user-agent";
import { pageEditorPreloadPath } from "../page-editor/sessions";
import { isDrivenInstance } from "../windows/on-screen";
import { type DeviceEmulation, setDeviceEmulation } from "./device-emulation";
import { sendCommand } from "./dispatch-command";
import { captureDownloadWillBeginGuid } from "./downloads";
import {
  advanceEntry,
  type BrowserEntry,
  createEntry,
  destroyEntry,
  handleDetach,
  hasGuest,
  nextEntryPhase,
  subscribeEvents,
} from "./entry";
import {
  bouncesGuestFocus,
  createFocusGuard,
  isAgentDrivenCommand,
} from "./focus-guard";
import { isBlocking } from "./content-blocking";
import { attachGuestInteractions } from "./guest-interactions";
import { forgetRasterBudget } from "./guest-surface";
import { noteUserInput } from "./external-app-links";
import { resyncPagesAfterFullScreen } from "./full-screen-exit";
import { guests } from "./guest-registry";
import {
  createCertificateExceptions,
  createSignInRequests,
  guardGuestSecurity,
} from "./guest-security";
import { guestCost } from "./guest-cost";
import { configureGuestSession } from "./guest-session";
import { mayGuestSleep, sleepGuest, wakeGuest } from "./guest-sleep";
import {
  noteRestored,
  signInAt,
  signInPending,
  takeRestored,
  takeTyped,
} from "./history-intents";
import {
  createTabRecorder,
  type NavigationSnapshot,
  type TabRecorder,
} from "./history-recorder";
import { getHistoryStore } from "./history-store";
import { mayPageNavigateTo } from "./local-file-policy";
import { log } from "./log";
import { stopScreencast } from "./screencast";
import {
  guestWindowOpenHandler,
  isFileUrl,
  newTabOpenOf,
  sameTabNavigationUrl,
} from "./window-open-policy";

// How long createTarget waits for the renderer to mount the guest `<webview>`
// and Electron to fire `did-attach-webview`. The app window's renderer is alive
// whenever the agent runs, so attach normally completes in well under a second;
// the timeout only fires if no renderer is available to host the guest.
const ATTACH_TIMEOUT_MS = 15_000;

// How long a page leaving for another window gets to say where it is scrolled.
const PAGE_SCROLL_WAIT_MS = 80;
// How long a window waits on a page handed to it before showing what there is.
const PAGE_LOAD_WAIT_MS = 2000;
// How long before a navigation starts an agent's command still claims it.
// Electron says nothing about who started a navigation, so it is read off
// the agent's own traffic: a command arrives just before the click or the
// navigate it causes. A page's own script that navigates later than this
// after an agent's click is counted as the person's.
const AGENT_NAVIGATION_TAIL_MS = 2000;

// How long after an agent's last command its page stays in the window it is in.
const AGENT_KEEPS_GUEST_MS = 30_000;

const agentCommandTimers = new WeakMap<
  BrowserEntry,
  ReturnType<typeof setTimeout>
>();

// How long a guest brought over from another window waits on its page.
const RESTORE_WAIT_MS = 5000;

export interface BrowserViewManager {
  // Register the `<webview>` attach lifecycle on a window's webContents.
  // Called once the window exists, whether or not a workspace has started:
  // the manager is the app's, so a window opened during setup hosts the
  // guests of the workspace setup starts.
  bindHost: (host: WebContents, options?: { isSpare?: () => boolean }) => void;
  // Whether a person has used a page this window's renderer mounts, those named
  // left out: what taking the renderer away from them would lose.
  hasUsedPage: (
    webContentsId: number,
    except?: readonly BrowserTargetId[],
  ) => boolean;
  // Whether a person has used any of these pages.
  isPageUsed: (targets: readonly BrowserTargetId[]) => boolean;
  browser: BrowserConfig;
  // The targets one window's renderer mounts and whether each guest has
  // attached yet. Its pool mounts a guest for every id; the UI treats only
  // attached ones as live.
  getTargets: (webContentsId: number) => BrowserGuestTarget[];
  // The targets other windows' renderers mount, and whether each shows its
  // page: what a window showing that tab says instead of opening it.
  getTargetsElsewhere: (
    webContentsId: number,
  ) => { isInUse: boolean; targetId: BrowserTargetId }[];
  // Whether a window's renderer mounts this target, so that what is asked of
  // its guest goes to that window alone.
  isHostOf: (webContentsId: number, targetId: BrowserTargetId) => boolean;
  // The guest goes to this window now, as its tab does, with nothing left for
  // the windows to settle between them. Resolves with its page loaded there
  // and scrolled back to where it stood, or once that is no longer worth
  // waiting for.
  handOffGuest: (
    targetId: BrowserTargetId,
    webContentsId: number,
  ) => Promise<void>;
  // Every page one window's renderer mounts, to another, for a window on its way
  // out with an agent or a person still having use for them.
  handOffGuestsOf: (fromWebContentsId: number, toWebContentsId: number) => void;
  // Apply (or, with `device: null`, clear) device emulation on a guest via
  // CDP -- the panel's "View as" menu. See device-emulation.ts for why
  // this is safe here (the caller always computes scale from live bounds and
  // only offers a few bounded, real device sizes) when the same CDP method is
  // refused outright for agent-browser callers.
  setEmulatedDevice: (
    targetId: BrowserTargetId,
    device: DeviceEmulation | null,
  ) => void;
  // Record renderer-reported DOM focus/blur on a guest's `<webview>` element,
  // which is what tells a person taking the guest from focus the agent's own
  // command caused. `webContents.isFocused()` is unreliable for `<webview>`
  // guests (it can get stuck `true` after focus moves to a plain host-page
  // element).
  setGuestFocus: (targetId: BrowserTargetId, focused: boolean) => void;
  // Record whether a slot in the window shows a guest or the pool parks it,
  // as the renderer pool reports each change.
  setGuestShown: (targetId: BrowserTargetId, shown: boolean) => void;
  // Trust the certificate a tab's page was last refused, when it was for
  // `url`'s site, and load `url` again under it: "Continue" on the page that
  // says the connection isn't private. False when there is none to trust.
  continueDespiteCertificate: (
    targetId: BrowserTargetId,
    url: string,
  ) => boolean;
  // How a tab's last page load ended, for a panel that started listening to
  // its guest after it did: a guest's first load can fail before the panel
  // showing it has its listeners on.
  lastLoadOf: (targetId: BrowserTargetId) => GuestLastLoad | null;
  // Record focus returning to any element in the host renderer.
  setHostFocus: () => void;
  teardown: () => void;
}

let managerInstance: BrowserViewManager | undefined;

/** How each tab's last main-frame load ended, until its next one starts. */
const lastLoads = new WeakMap<BrowserEntry, GuestLastLoad>();

/** The sign-ins the window's tabs are waiting on, which the window draws. */
export const guestSignIns = createSignInRequests(() => {
  publisher.publish("browser.sign-ins-changed", null);
});

/** The certificates a person chose to trust anyway, for as long as the app runs. */
export const certificateExceptions = createCertificateExceptions(() => {
  publisher.publish("browser.certificate-exceptions-changed", null);
});

// Whether the host renderer is showing a guest: `parked` when it or an
// ancestor is at the pool's near-zero parking opacity, `offscreen` when laid
// out outside the window, `missing` when no mounted webview holds it.
const describeTabScript = (guestId: number) => `(() => {
  const webview = [...document.querySelectorAll("webview")].find((w) => {
    try { return w.getWebContentsId() === ${guestId}; } catch { return false; }
  });
  if (!webview) return "missing";
  for (let el = webview; el; el = el.parentElement) {
    if (Number(getComputedStyle(el).opacity) < 0.01) return "parked";
  }
  const r = webview.getBoundingClientRect();
  const onScreen = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  return onScreen ? "shown" : "offscreen";
})()`;

function createBrowserViewManager(): BrowserViewManager {
  const entries = new Map<BrowserTargetId, BrowserEntry>();
  // The window a guest nothing asked for in particular goes to: the one last
  // in front.
  let frontHost: null | WebContents = null;
  const liveHosts = new Set<WebContents>();
  // A spare window draws the tabs a drag gives it while nothing has changed
  // hands, and the drag says which pages come over. It is no window to go to, and
  // a page it happens to show is not one it gets to take.
  const spareChecks = new Map<number, () => boolean>();
  const isSpareHost = (id: number) => spareChecks.get(id)?.() ?? false;
  // The window whose renderer mounts a target, settled on it for good as soon
  // as there is a window to ask.
  const hostIdOf = (entry: BrowserEntry) => {
    entry.hostId ??= frontHost?.id ?? null;
    return entry.hostId;
  };
  const hostOf = (targetId: BrowserTargetId) => {
    const entry = entries.get(targetId);
    const id = entry && hostIdOf(entry);
    if (id === null || id === undefined) {
      return null;
    }
    return [...liveHosts].find((host) => host.id === id) ?? null;
  };
  // Bounces focus stolen by agent CDP activity back to the host renderer.
  const focusGuard = createFocusGuard({ restoreHostFocus });

  // Whether the user could have seen a target's guest: its window's state, and
  // whether the host renderer shows its tab or parks it (see browser-pool.ts).
  // Written into the log line for each agent press.
  async function describeHost(targetId: BrowserTargetId): Promise<string> {
    const host = hostOf(targetId);
    const guestId = entries.get(targetId)?.webContents?.id;
    if (!host || host.isDestroyed() || guestId === undefined) {
      return "window=none";
    }
    const win = BrowserWindow.fromWebContents(host);
    const window = win
      ? win.isMinimized()
        ? "minimized"
        : win.isVisible()
          ? win.isFocused()
            ? "focused"
            : "unfocused"
          : "hidden"
      : "none";
    const tab: unknown = await host
      .executeJavaScript(describeTabScript(guestId))
      .catch(() => "unknown");
    return `window=${window} tab=${String(tab)}`;
  }

  function restoreHostFocus(targetId: BrowserTargetId) {
    const host = hostOf(targetId);
    if (
      !host ||
      host.isDestroyed() ||
      !BrowserWindow.fromWebContents(host)?.isFocused()
    ) {
      return;
    }
    publisher.publish("browser.restore-host-focus", { targetId });
  }

  // Ask the renderer to put keyboard focus on a guest. Only renderer-side DOM
  // focus on the `<webview>` element crosses the process boundary, so this is
  // the one way the main process can make agent keyboard input land in the
  // page it was addressed to.
  function requestGuestFocus(targetId: BrowserTargetId) {
    publisher.publish("browser.focus-guest", { targetId });
  }

  function ensureDebuggerAttached(entry: BrowserEntry) {
    const wc = entry.webContents;
    if (!wc || wc.isDestroyed()) {
      return;
    }
    if (wc.debugger.isAttached()) {
      return;
    }
    const { targetId } = entry;
    wc.debugger.attach("1.3");
    // Pairs with the guest session's product-branded client hints: the headers
    // and navigator.userAgentData have to name the same browser, and this is
    // the only side that needs the debugger.
    applyProductBrandedMetadata(wc);

    // An event from a frame the debugger attached under a session of its own
    // carries that session's id; the page's own carry an empty one.
    wc.debugger.on(
      "message",
      (_event, method, params: unknown, sessionId: string) => {
        const current = entries.get(targetId);
        if (!current) {
          return;
        }
        const frameSession = sessionId || undefined;
        if (method === "Page.downloadWillBegin" && frameSession === undefined) {
          captureDownloadWillBeginGuid(current, params);
        }
        for (const listener of current.eventListeners) {
          listener(method, params, frameSession);
        }
      },
    );

    wc.debugger.on("detach", () => {
      // A guest this tab has since replaced, in another window, is not the tab.
      if (entries.get(targetId) !== entry) {
        return;
      }
      handleDetach(entries, targetId);
      notifyEntriesChanged();
    });
  }

  function bindGuest(entry: BrowserEntry, guest: WebContents) {
    entry.webContents = guest;
    const { targetId } = entry;
    guests.bind(guest.id, entry);
    const pageDocument = () => guests.documentOf(guest.id, guest.mainFrame);

    // Where a link on the page may take a tab: a file only from a page on
    // the computer, as Chromium itself allows, and within what an agent
    // driving the tab may reach.
    const mayOpenFromPage = (url: string) => {
      const from = pageDocument();
      return (
        (!isFileUrl(url) || (from !== undefined && isFileUrl(from))) &&
        mayPageNavigateTo(entry.agentFileRoots, from, url)
      );
    };

    // A page the agent can read may not take its tab to a file the agent
    // cannot; see `mayPageNavigateTo`. Fires only for navigations the page
    // starts, never for the address bar or the agent's own `Page.navigate`.
    guest.on("will-frame-navigate", (details) => {
      if (
        details.isMainFrame &&
        !mayPageNavigateTo(entry.agentFileRoots, pageDocument(), details.url)
      ) {
        log.warn(
          `refused a page taking its tab outside the agent's folders targetId=${targetId}`,
        );
        details.preventDefault();
        publisher.publish("browser.navigation-refused", {
          targetId,
        });
      }
    });

    // Allow only genuine sign-in popups, and only when the user -- not agent CDP
    // activity -- is driving this guest. A popup the agent triggers would be a
    // separate window it can neither see nor control (no CDP debugger, not in
    // the entry map) and that the user never asked for, so deny while the guest
    // is agent-guarded. When the user drives it, the child window inherits the
    // guest's locked-down, same-partition session (see guestWindowOpenHandler),
    // so the opener/postMessage channel that "Continue with Google" and similar
    // flows complete through stays intact instead of hanging.
    guest.setWindowOpenHandler((details) => {
      const response: WindowOpenHandlerResponse = focusGuard.isGuarded(targetId)
        ? { action: "deny" }
        : guestWindowOpenHandler(details);
      if (response.action === "deny") {
        // A tab-open gets a tab of its own, as a browser does, while a person
        // rather than an agent is driving the page.
        const newTab = focusGuard.isGuarded(targetId)
          ? null
          : newTabOpenOf(details, pageDocument());
        if (newTab && mayOpenFromPage(newTab.url)) {
          publisher.publish("browser.open-in-new-tab", {
            ...newTab,
            targetId,
          });
          return response;
        }
        // A denied open leaves the click with nowhere to go, so send the ones
        // that mean "show me this page" to the page it came from. This runs
        // even while the guest is agent-guarded, where it is the only way a
        // `target=_blank` link is reachable at all: the guard withholds a
        // window, not a navigation, and the agent's CDP connection is pinned to
        // this one page. Deferred because the handler runs inside Chromium's
        // decision for this navigation, and starting another from underneath it
        // is not something Electron promises to survive.
        const url = sameTabNavigationUrl(details);
        if (url != null) {
          setImmediate(() => {
            if (!guest.isDestroyed()) {
              void guest.loadURL(url).catch(noop);
            }
          });
        }
      }
      return response;
    });
    guardGuestSecurity(guest, targetId, {
      exceptions: certificateExceptions,
      signIns: guestSignIns,
    });
    // Muted until a person uses the page: an agent drives it, often while
    // nobody is looking, and its CDP clicks count as the user gesture a page
    // needs to start sound. The first click, tap or key press of a person's
    // in the tab lets it play sound for the rest of the tab's life, and so
    // does a page the person opens from the window (`allowSound` in the
    // renderer's `browser-pool.ts`).
    guest.setAudioMuted(true);
    // Keep the guest's timers and animations running while the Studio window
    // is minimized or occluded (e.g. the agent works while the user is in
    // another app). It does not guarantee frames: a guest in a window covered
    // by another app's, or minimized, can render nothing while still reporting
    // itself visible. Captures and input make the window draw instead
    // (embedder-draw.ts).
    guest.setBackgroundThrottling(false);

    // Mouse thumb-button navigation + right-click menu so the user can drive it.
    attachGuestInteractions(guest, {
      mayOpen: mayOpenFromPage,
      openInNewTab: (url: string) => {
        publisher.publish("browser.open-in-new-tab", {
          background: false,
          targetId,
          url,
        });
      },
      step: (direction) => {
        publisher.publish("browser.step-page", { direction, targetId });
      },
    });

    const history = recordHistory(entry, guest);
    guest.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        lastLoads.delete(entry);
        focusGuard.onNavigationStart(targetId);
        markNavigated(entry, details.url);
        history.start(details.url);
      }
    });
    guest.on("did-redirect-navigation", (details) => {
      if (details.isMainFrame) {
        history.redirect(details.url);
      }
    });
    // The blank page every guest is born on is not somewhere the page has
    // been: once it has somewhere real, that start leaves its history, so
    // back from its first page is the tab's back rather than a step onto
    // an empty page. History compares the list as the commit left it,
    // before the blank start goes, and settles on it after.
    guest.on("did-navigate", (_event, url, httpResponseCode) => {
      if (!lastLoads.get(entry)?.errorCode) {
        lastLoads.set(entry, { httpResponseCode, url });
      }
      history.commit({
        after: navigationSnapshot(guest),
        status: httpResponseCode,
        url,
      });
      if (url !== "about:blank") {
        dropBlankStart(guest);
      }
      history.settle(navigationSnapshot(guest));
    });
    guest.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        history.commitSameDocument({ after: navigationSnapshot(guest), url });
        history.settle(navigationSnapshot(guest));
      }
    });
    guest.on("page-title-updated", (_event, title, explicitSet) => {
      history.title(title, explicitSet);
    });
    guest.on("page-favicon-updated", (_event, favicons) => {
      const favicon = favicons[0];
      if (favicon) {
        history.favicon(favicon);
      }
    });
    guest.on("dom-ready", () => {
      focusGuard.onLoadProgress(targetId);
    });
    guest.on("did-finish-load", () => {
      focusGuard.onLoadProgress(targetId);
    });
    guest.on("did-stop-loading", () => {
      focusGuard.onLoadSettled(targetId);
      history.stoppedLoading();
    });
    guest.on("focus", () => {
      focusGuard.onGuestFocus(targetId);
    });
    guest.on("input-event", (_event, input) => {
      const byPerson = noteUserInput(
        guests.get(guest.id),
        input.type,
        focusGuard.isGuarded(targetId),
      );
      if (byPerson && guest.isAudioMuted()) {
        guest.setAudioMuted(false);
      }
    });

    guest.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) {
          history.failed(validatedURL);
          lastLoads.set(entry, {
            errorCode,
            errorDescription,
            url: validatedURL,
          });
        }
        // Only the host goes in the log: a page's full address can carry
        // tokens and says what the user was looking at.
        if (errorCode !== -3) {
          const url = URL.parse(validatedURL);
          log.error(
            `did-fail-load targetId=${entry.targetId} host=${url?.host || url?.protocol || "unknown"} errorCode=${errorCode} errorDescription=${errorDescription}`,
          );
        }
        // ERR_ABORTED (-3) is a normal interrupted navigation. Any other failure
        // of the initial load would leave `attach` pending until the 15s timeout;
        // settle it so createTarget resolves against the bound guest (CDP still
        // works) instead of hanging. A no-op once did-finish-load has resolved.
        if (errorCode !== -3 && advanceEntry(entry, "loadSettled")) {
          ensureDebuggerAttached(entry);
          entry.attach.resolve();
          notifyEntriesChanged();
        }
      },
    );

    guest.on("destroyed", () => {
      if (entries.get(targetId) !== entry) {
        return;
      }
      focusGuard.forgetTarget(targetId);
      handleDetach(entries, targetId);
      notifyEntriesChanged();
    });
    guest.on("render-process-gone", () => {
      if (entries.get(targetId) !== entry) {
        return;
      }
      focusGuard.forgetTarget(targetId);
      destroyEntry(entries, targetId);
      notifyEntriesChanged();
    });

    entry.disposers.add(() => {
      stopScreencast(entry);
    });
    entry.disposers.add(() => {
      const wc = entry.webContents;
      if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) {
        try {
          wc.debugger.detach();
        } catch {
          // Already detached
        }
      }
    });

    // Materialize the main RenderFrame; without an initial navigation CDP
    // commands like Page.enable hang and Page.navigate has no frame. The
    // element already loads about:blank, but driving it here gives us a
    // deterministic did-finish-load to resolve the handshake on.
    const settle = () => {
      advanceEntry(entry, "loadSettled");
      ensureDebuggerAttached(entry);
      entry.attach.resolve();
      // The guest is now attached; re-publish so subscribers (the UI's live
      // view) flip this target from pending to live.
      notifyEntriesChanged();
    };
    // A guest brought over from another window comes up on the page it stood
    // on, which its element loads (`BrowserGuestTarget.src`), over the pages
    // behind it, which have to go in before that load lands. That page can be
    // slow to answer, and the guest is not held up for it.
    const { restoreHistory } = entry;
    guest.once("did-finish-load", settle);
    if (restoreHistory) {
      entry.restoreHistory = null;
      if (restoreHistory.behind.length > 0) {
        void guest.navigationHistory
          .restore({
            entries: restoreHistory.behind,
            index: restoreHistory.behind.length - 1,
          })
          .catch(noop);
      }
      setTimeout(() => {
        if (!entry.attach.settled && entries.get(entry.targetId) === entry) {
          guest.off("did-finish-load", settle);
          settle();
        }
      }, RESTORE_WAIT_MS);
    } else {
      void guest.loadURL("about:blank");
    }
  }

  // A person's input, or an agent's commands: either leaves state a reload loses.
  const isUsed = (entry: BrowserEntry) => {
    const guestId = entry.webContents?.id;
    return (
      entry.lastAgentCommandAt > 0 ||
      (guestId !== undefined && (guests.get(guestId)?.userInputAt ?? 0) > 0)
    );
  };

  function bindHost(
    host: WebContents,
    { isSpare }: { isSpare?: () => boolean } = {},
  ) {
    liveHosts.add(host);
    if (isSpare) {
      spareChecks.set(host.id, isSpare);
    }
    if (!isSpareHost(host.id)) {
      frontHost = host;
    }
    const hostWindow = BrowserWindow.fromWebContents(host);
    if (hostWindow) {
      resyncPagesAfterFullScreen(hostWindow);
      hostWindow.on("focus", () => {
        frontHost = host;
      });
    }
    host.once("destroyed", () => {
      liveHosts.delete(host);
      spareChecks.delete(host.id);
      forgetRasterBudget(host.id);
      if (frontHost === host) {
        frontHost =
          [...liveHosts].filter((each) => !isSpareHost(each.id)).at(-1) ?? null;
      }
      // A guest not yet mounted goes to a window that can mount it; one that
      // was is gone with its window, and comes back when its tab is shown.
      for (const entry of entries.values()) {
        if (entry.hostId === host.id && !hasGuest(entry)) {
          entry.hostId = null;
        }
      }
      notifyEntriesChanged();
    });
    // A FIFO of entries accepted in `will-attach-webview`, drained in
    // `did-attach-webview`: Electron pairs the two events in order, and the
    // guest it hands over carries nothing naming its target. The entry rather
    // than its id, so a target removed and created again in between is not
    // bound to the guest mounted for the one before it.
    const pendingAttachQueue: BrowserEntry[] = [];
    host.on("will-attach-webview", (event, webPreferences, params) => {
      const targetId = targetIdFromPartition(params.partition);
      if (!targetId) {
        // Every `<webview>` the app mounts carries a target partition, so one
        // without it came from elsewhere and would attach with whatever
        // webPreferences its attributes asked for. Reject it.
        log.warn(
          `rejected webview attach (foreign partition) partition=${params.partition ?? "none"}`,
        );
        event.preventDefault();
        return;
      }
      const entry = entries.get(targetId);
      if (!entry) {
        // No page state recorded for this id: reject the attachment.
        log.warn(
          `rejected browser webview attach (no entry) targetId=${targetId}`,
        );
        event.preventDefault();
        return;
      }
      if (!advanceEntry(entry, "willAttach")) {
        // Already bound to a guest: a second attach for the same id would
        // rebind and orphan the first guest's debugger. Reject it.
        log.warn(
          `rejected browser webview attach (already bound) targetId=${targetId}`,
        );
        event.preventDefault();
        return;
      }

      // The partition carries the target id for this attach. The workspace
      // profile keeps cookies and storage shared across its tasks.
      webPreferences.session = configureGuestSession(entry.partitionDir);
      webPreferences.contextIsolation = true;
      webPreferences.nodeIntegration = false;
      webPreferences.sandbox = true;
      // Pinned explicitly to guard against a future Electron default flip
      // silently weakening this agent-controlled browsing context. This is the
      // hook whose job is to sanitize webPreferences a renderer-supplied
      // `webpreferences` attribute could have influenced.
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      webPreferences.webSecurity = true;
      // Electron defaults guest pages to a transparent backdrop, so a page that
      // sets no background of its own composites over the app chrome instead of
      // the white a browser would show. Opt out to match ordinary browser
      // behavior, which also covers the gap before a page paints its own
      // background (runtime-compiled CSS, slow loads, about:blank).
      webPreferences.transparent = false;
      // In an agent's instance a page keeps drawing while the window is off
      // screen or covered; the window's own setting does not reach its guests.
      if (isDrivenInstance()) {
        webPreferences.backgroundThrottling = false;
      }
      // Inert on every page but a file being edited in place, where it hands
      // the editor to the guest's isolated world; see page-editor/sessions.ts.
      webPreferences.preload = pageEditorPreloadPath();

      pendingAttachQueue.push(entry);
    });

    host.on("did-attach-webview", (_event, guest) => {
      const entry = pendingAttachQueue.shift();
      if (!entry) {
        return;
      }
      if (!advanceEntry(entry, "didAttach")) {
        // Removed since, or bound by a `<webview>` mounted alongside this one;
        // don't rebind and stack a second set of disposers on the entry.
        log.warn(
          `ignored did-attach-webview phase=${entry.phase} targetId=${entry.targetId}`,
        );
        return;
      }
      bindGuest(entry, guest);
    });
  }

  // Another window leaves a page alone while its window shows it, and while an
  // agent is at work in it, since coming over is a reload.
  const isInUse = (entry: BrowserEntry) =>
    entry.shown || Date.now() - entry.lastAgentCommandAt < AGENT_KEEPS_GUEST_MS;

  function noteAgentCommand(entry: BrowserEntry) {
    const wasInUse = isInUse(entry);
    entry.lastAgentCommandAt = Date.now();
    if (!wasInUse) {
      notifyEntriesChanged();
    }
    clearTimeout(agentCommandTimers.get(entry));
    agentCommandTimers.set(
      entry,
      setTimeout(notifyEntriesChanged, AGENT_KEEPS_GUEST_MS),
    );
  }

  /** Where a page stands, asked briefly: a page too busy to say comes back at its top. */
  async function pageScrollOf(guest: BrowserEntry["webContents"]) {
    if (!guest || guest.isDestroyed()) {
      return null;
    }
    const asked: unknown = await Promise.race([
      guest.executeJavaScript("[scrollX, scrollY]").catch(() => null),
      new Promise((resolve) => {
        setTimeout(resolve, PAGE_SCROLL_WAIT_MS, null);
      }),
    ]);
    return Array.isArray(asked) && asked.every(Number.isFinite)
      ? { x: Number(asked[0]), y: Number(asked[1]) }
      : null;
  }

  /** Resolves when a guest come up in a new window has loaded, and has its place on the page back. */
  async function settlePage(
    guest: NonNullable<BrowserEntry["webContents"]>,
    scroll: { x: number; y: number } | null,
  ) {
    if (
      guest.isLoading() ||
      guest.getURL() === "" ||
      guest.getURL() === "about:blank"
    ) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(limit);
          guest.off("did-stop-loading", done);
          resolve();
        };
        const limit = setTimeout(done, PAGE_LOAD_WAIT_MS);
        guest.once("did-stop-loading", done);
      });
    }
    if (scroll && (scroll.x !== 0 || scroll.y !== 0) && !guest.isDestroyed()) {
      await guest
        .executeJavaScript(`scrollTo(${scroll.x}, ${scroll.y})`)
        .catch(() => undefined);
    }
  }

  /**
   * A guest of another window's, brought to this one. A guest cannot change
   * the renderer it is attached to, so this is a fresh guest that reloads its
   * page, with its history, in place of the one that goes.
   */
  function moveTarget(
    existing: BrowserEntry,
    partitionDir: AbsolutePath,
    hostId: number,
  ) {
    const guest = existing.webContents;
    let restoreHistory: BrowserEntry["restoreHistory"] = null;
    if (guest && !guest.isDestroyed()) {
      restoreHistory = historyToRestore(
        guest.navigationHistory.getAllEntries(),
        guest.navigationHistory.getActiveIndex(),
      );
    }
    destroyEntry(entries, existing.targetId);
    const entry = createEntry({
      hostId,
      partitionDir,
      restoreHistory,
      ...(restoreHistory ? { src: restoreHistory.url } : {}),
      targetId: existing.targetId,
    });
    // The window taking it is showing it, which it says itself only once the
    // guest has come up; until then another window showing this tab must not
    // take it straight back.
    entry.shown = true;
    entries.set(existing.targetId, entry);
    notifyEntriesChanged();
    return waitForAttach(entry);
  }

  async function handOffGuest(
    targetId: BrowserTargetId,
    webContentsId: number,
  ) {
    const existing = entries.get(targetId);
    if (!existing || hostIdOf(existing) === webContentsId) {
      return;
    }
    const scroll = await pageScrollOf(existing.webContents);
    // Handed on again, or closed, while the page answered.
    if (entries.get(targetId) !== existing) {
      return;
    }
    await moveTarget(existing, existing.partitionDir, webContentsId).catch(
      () => undefined,
    );
    const guest = entries.get(targetId)?.webContents;
    if (guest && !guest.isDestroyed()) {
      await settlePage(guest, scroll);
    }
  }

  function createTarget(
    targetId: BrowserTargetId,
    partitionDir: AbsolutePath,
    host?: { take?: "always" | "parked"; webContentsId: number },
  ): Promise<void> {
    const existing = entries.get(targetId);
    if (existing) {
      const hostId = hostIdOf(existing);
      if (
        host?.take !== undefined &&
        hostId !== host.webContentsId &&
        (host.take === "always" ||
          hostOf(targetId) === null ||
          (!isInUse(existing) && !isSpareHost(host.webContentsId)))
      ) {
        return moveTarget(existing, partitionDir, host.webContentsId);
      }
      // Idempotent: a tab owns at most one guest. Already bound -> reuse it;
      // mount still in flight -> wait on it.
      if (hasGuest(existing)) {
        return Promise.resolve();
      }
      return waitForAttach(existing);
    }

    const entry = createEntry({
      hostId: host?.webContentsId ?? null,
      partitionDir,
      targetId,
    });
    entries.set(targetId, entry);
    // Publishing the new desired set makes the renderer pool mount a guest
    // `<webview>` for this target; it attaches via will/did-attach-webview,
    // which binds it and resolves entry.attach. Removal (destroyEntry/
    // handleDetach) rejects entry.attach and republishes, so the pool disposes
    // the guest -- no explicit unmount needed.
    notifyEntriesChanged();

    return waitForAttach(entry);
  }

  // Resolve when the guest attaches (entry.attach), reject if the entry is
  // removed first (attach rejects) or nothing mounts within the timeout. The
  // timeout drops the orphaned page-state entry so a retry starts clean.
  function waitForAttach(entry: BrowserEntry): Promise<void> {
    if (entry.attach.settled) {
      return entry.attach.promise;
    }
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        if (nextEntryPhase(entry.phase, "attachTimedOut")) {
          destroyEntry(entries, entry.targetId);
          notifyEntriesChanged();
        }
        reject(new Error(`browser attach timed out: ${entry.targetId}`));
      }, ATTACH_TIMEOUT_MS);
      const clear = () => {
        clearTimeout(timer);
      };
      entry.attach.promise.then(clear, clear);
    });
    return Promise.race([entry.attach.promise, timeout]);
  }

  function listTargets(): Promise<BrowserTarget[]> {
    const targets: BrowserTarget[] = [];

    for (const [targetId, entry] of entries) {
      const wc = entry.webContents;
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      if (!wc || wc.isDestroyed()) {
        continue;
      }

      targets.push({
        id: targetId,
        title: wc.getTitle() || "about:blank",
        type: "page",
        url: wc.getURL() || "about:blank",
      });
    }

    return Promise.resolve(targets);
  }

  function onTargetDestroyed(
    targetId: BrowserTargetId,
    listener: () => void,
  ): () => void {
    const entry = entries.get(targetId);
    if (!entry) {
      // Already destroyed (or never existed): fire the listener immediately
      // so callers don't have to special-case races.
      listener();
      return noop;
    }
    entry.destructionListeners.add(listener);
    return () => {
      entry.destructionListeners.delete(listener);
    };
  }

  const browser: BrowserConfig = {
    hasNoWindow: false,
    closeTarget: (targetId) =>
      new Promise<void>((resolve) => {
        // Resolve only after the destruction listener fires (which happens as
        // part of the disposer chain). If the entry is already gone,
        // onTargetDestroyed fires the listener synchronously.
        onTargetDestroyed(targetId, resolve);
        destroyEntry(entries, targetId);
        notifyEntriesChanged();
      }),
    createTarget,
    getTargetMeta: (targetId) => {
      const entry = entries.get(targetId);
      if (!entry) {
        return null;
      }
      return { partitionDir: entry.partitionDir };
    },
    guestCost: (targetId) => guestCost(entries, targetId),
    isGuestAsleep: (targetId) => entries.get(targetId)?.asleep ?? false,
    isGuestBusy: (targetId) => {
      const entry = entries.get(targetId);
      const guest = entry?.webContents;
      return (
        entry !== undefined &&
        (entry.downloadsRunning > 0 ||
          (guest !== null &&
            guest !== undefined &&
            !guest.isDestroyed() &&
            (guest.isCurrentlyAudible() || guest.isDevToolsOpened())))
      );
    },
    getTargetUrl: (targetId) => {
      const entry = entries.get(targetId);
      const guest = entry?.webContents;
      return guest && !guest.isDestroyed()
        ? guests.documentOf(guest.id, guest.mainFrame)
        : undefined;
    },
    contentBlocking: (targets, blocking) => ({
      task: guests.setAdBlocking(targets, blocking),
      workspace: isBlocking(),
    }),
    listTargets,
    noteRestore: noteRestored,
    onTargetDestroyed,
    sendCommand: (async (
      targetId: BrowserTargetId,
      method: string,
      params?: unknown,
      frameSession?: string,
    ) => {
      // Every command reaches the page through here, so a sleeping guest is
      // woken, and has drawn a frame, before any of them is sent.
      const entry = entries.get(targetId);
      if (entry) {
        await wakeGuest(entry, notifyEntriesChanged);
      }
      const dispatch = () =>
        sendCommand({
          describeHost,
          ensureDebuggerAttached,
          entries,
          frameSession,
          method,
          params,
          requestGuestFocus,
          targetId,
        });
      if (!isAgentDrivenCommand(method)) {
        return dispatch();
      }
      const driven = entries.get(targetId);
      if (driven) {
        noteAgentCommand(driven);
      }
      const settle = focusGuard.armCommand(
        targetId,
        hostOf(targetId)?.isFocused() ?? false,
        bouncesGuestFocus(method),
      );
      try {
        return await dispatch();
      } finally {
        settle();
      }
    }) satisfies BrowserConfig["sendCommand"],
    sleepGuest: (targetId) => {
      const entry = entries.get(targetId);
      const guest = entry?.webContents;
      if (!entry || entry.asleep || !guest || guest.isDestroyed()) {
        return;
      }
      if (
        !mayGuestSleep(entry, {
          busy: browser.isGuestBusy(targetId),
          fullScreen: guests.get(guest.id)?.htmlFullScreen ?? false,
        })
      ) {
        return;
      }
      sleepGuest(entry, guest);
      notifyEntriesChanged();
    },
    setAgentFileRoots: (targetId, roots) => {
      const entry = entries.get(targetId);
      if (entry) {
        entry.agentFileRoots = roots;
      }
    },
    stopScreencast: (targetId) => {
      const entry = entries.get(targetId);
      if (entry) {
        stopScreencast(entry);
      }
    },
    subscribeEvents: (targetId, onDetach, onEvent) =>
      subscribeEvents({
        ensureDebuggerAttached,
        entries,
        onDetach,
        onEvent,
        targetId,
      }),
  };

  // The panel calls this to reconcile a guest's device emulation to the
  // currently-desired state every time it shows the guest (and whenever the
  // selected device changes): `device: null` clears any override, which also
  // self-heals a guest left emulated by an older CDP session or a park (see
  // setDeviceEmulation's rationale).
  function setEmulatedDevice(
    targetId: BrowserTargetId,
    device: DeviceEmulation | null,
  ) {
    const entry = entries.get(targetId);
    if (!entry) {
      return;
    }
    setDeviceEmulation({ device, ensureDebuggerAttached, entry });
  }

  function setGuestFocus(targetId: BrowserTargetId, focused: boolean) {
    if (!focused || focusGuard.bounceGuestFocus(targetId)) {
      return;
    }
    // Only a user taking the guest hands the claim over. Focus that the
    // agent's own command caused (a CDP click, which the guest needs before
    // it can be typed into at all) leaves the host owning the caret, so it
    // returns once the agent goes quiet.
    if (!focusGuard.isGuarded(targetId)) {
      focusGuard.releaseHost();
    }
  }

  function setHostFocus() {
    focusGuard.claimHost();
  }

  function continueDespiteCertificate(targetId: BrowserTargetId, url: string) {
    const guest = entries.get(targetId)?.webContents;
    if (
      !guest ||
      guest.isDestroyed() ||
      !certificateExceptions.allowRefused(guest.id, url)
    ) {
      return false;
    }
    void guest.loadURL(url).catch(noop);
    return true;
  }

  return {
    bindHost,
    browser,
    continueDespiteCertificate,
    lastLoadOf: (targetId) => {
      const entry = entries.get(targetId);
      return (entry && lastLoads.get(entry)) ?? null;
    },
    getTargets: (webContentsId) =>
      [...entries.values()]
        .filter((entry) => hostIdOf(entry) === webContentsId)
        .map((entry) => ({
          asleep: entry.asleep,
          attached: hasGuest(entry),
          generation: entry.generation,
          id: entry.targetId,
          navigated: entry.navigated,
          src: entry.src,
        })),
    getTargetsElsewhere: (webContentsId) =>
      [...entries.values()]
        .filter((entry) => hostIdOf(entry) !== webContentsId)
        .map((entry) => ({
          isInUse: isInUse(entry),
          targetId: entry.targetId,
        })),
    hasUsedPage: (webContentsId, except = []) =>
      [...entries.values()].some(
        (entry) =>
          hostIdOf(entry) === webContentsId &&
          !except.includes(entry.targetId) &&
          isUsed(entry),
      ),
    isPageUsed: (targets) =>
      targets.some((target) => {
        const entry = entries.get(target);
        return entry !== undefined && isUsed(entry);
      }),
    isHostOf: (webContentsId, targetId) => {
      const entry = entries.get(targetId);
      return entry !== undefined && hostIdOf(entry) === webContentsId;
    },
    handOffGuest,
    handOffGuestsOf: (fromWebContentsId, toWebContentsId) => {
      for (const entry of entries.values()) {
        if (hostIdOf(entry) === fromWebContentsId && hasGuest(entry)) {
          void handOffGuest(entry.targetId, toWebContentsId);
        }
      }
    },
    setEmulatedDevice,
    setGuestFocus,
    setGuestShown: (targetId, shown) => {
      const entry = entries.get(targetId);
      if (entry) {
        const changed = entry.shown !== shown;
        entry.shown = shown;
        if (shown) {
          void wakeGuest(entry, notifyEntriesChanged);
        }
        // Another window showing this tab says so only while this one shows it.
        if (changed) {
          notifyEntriesChanged();
        }
      }
    },
    setHostFocus,
    teardown: () => {
      for (const targetId of entries.keys()) {
        destroyEntry(entries, targetId);
      }
      notifyEntriesChanged();
    },
  };
}

/**
 * The app's one browser manager, made by whichever asks first: the window
 * binding itself as the guests' host, or the workspace taking the browser
 * its agents drive. Neither waits on the other, so a window that opens before
 * any workspace (a first launch's setup) still hosts the workspace's guests.
 */
export function getBrowserViewManager(): BrowserViewManager {
  return (managerInstance ??= createBrowserViewManager());
}

/**
 * A guest's history recorder, every call guarded: history is never worth a
 * navigation event handler throwing, so a store that cannot be written
 * (a full disk, a locked file) is logged once and recording goes quiet.
 *
 * A tab's navigation is the person's unless an agent's command for that tab
 * came shortly before it started.
 */
function recordHistory(entry: BrowserEntry, guest: WebContents): TabRecorder {
  const { targetId } = entry;
  let recorder: TabRecorder | undefined;
  let failed = false;
  const run = (call: (tab: TabRecorder) => void) => {
    if (failed) {
      return;
    }
    try {
      recorder ??= createTabRecorder({
        actorSince: (startedAt) =>
          (lastBrowserAgentActivity(targetId) ?? Number.NEGATIVE_INFINITY) >=
          startedAt - AGENT_NAVIGATION_TAIL_MS
            ? "agent"
            : "user",
        now: Date.now,
        signInAt,
        signInPending,
        sink: getHistoryStore(),
        takeRestored: (urls) => takeRestored(targetId, urls),
        takeTyped,
      });
      call(recorder);
    } catch (error) {
      failed = true;
      log.error(
        `history recording stopped targetId=${targetId} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const history: TabRecorder = {
    commit: (commit) => {
      run((tab) => {
        tab.commit(commit);
      });
    },
    commitSameDocument: (commit) => {
      run((tab) => {
        tab.commitSameDocument(commit);
      });
    },
    failed: (url) => {
      run((tab) => {
        tab.failed(url);
      });
    },
    favicon: (favicon) => {
      run((tab) => {
        tab.favicon(favicon);
      });
    },
    redirect: (url) => {
      run((tab) => {
        tab.redirect(url);
      });
    },
    settle: (after) => {
      run((tab) => {
        tab.settle(after);
      });
    },
    start: (url) => {
      run((tab) => {
        tab.start(url);
      });
    },
    stoppedLoading: () => {
      run((tab) => {
        tab.stoppedLoading();
      });
    },
    title: (title, explicit) => {
      run((tab) => {
        tab.title(title, explicit);
      });
    },
  };
  if (!guest.isDestroyed()) {
    history.settle(navigationSnapshot(guest));
  }
  return history;
}

/** Where a guest stands in its navigation list, for history to compare commits against. */
function navigationSnapshot(wc: WebContents): NavigationSnapshot {
  const history = wc.navigationHistory;
  return {
    index: history.getActiveIndex(),
    length: history.length(),
    urls: history.getAllEntries().map((entry) => entry.url),
  };
}

/** Removes the blank entries behind where a guest stands in its history. */
function dropBlankStart(wc: WebContents) {
  if (wc.isDestroyed()) {
    return;
  }
  const history = wc.navigationHistory;
  const entries = history.getAllEntries();
  for (let index = history.getActiveIndex() - 1; index >= 0; index -= 1) {
    if (entries[index]?.url === "about:blank") {
      history.removeEntryAtIndex(index);
    }
  }
}

// Record that a guest has started loading a real page, and republish so the UI
// can surface it. `about:blank` doesn't count: bindGuest loads it to materialize
// the RenderFrame, and agent-browser's own page bootstrap lands there too, so
// treating it as a navigation would mark every target navigated at birth.
function markNavigated(entry: BrowserEntry, url: string) {
  if (entry.navigated || url === "about:blank") {
    return;
  }
  entry.navigated = true;
  notifyEntriesChanged();
}

// Single notify for any change to the entry set: publish the new
// desired-targets set so the renderer pool reconciles its guests. Called at
// every add (createTarget) and removal (destroyEntry / handleDetach) site.
function notifyEntriesChanged() {
  publisher.publish("browser.targets-changed", null);
}
