import { publisher } from "@/electron-main/rpc/publisher";
import {
  type BrowserGuestTarget,
  targetIdFromPartition,
} from "@/shared/browser";
import {
  type AbsolutePath,
  type BrowserConfig,
  type BrowserTarget,
  type BrowserTargetId,
  encodeBrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/electron";
import {
  BrowserWindow,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";
import { noop } from "radashi";

import { applyProductBrandedMetadata } from "../lib/user-agent";
import { pageEditorPreloadPath } from "../page-editor/sessions";
import { attachDevHooks, notifyDebugChange } from "./dev-hooks";
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
import { guests } from "./guest-registry";
import { configureGuestSession } from "./guest-session";
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

export interface BrowserViewManager {
  // Register the `<webview>` attach lifecycle on a window's webContents.
  // Called once the window exists; the manager itself is created earlier. Each
  // window that mounts guests binds under its own name, and gets only the
  // guests meant for it.
  bindHost: (host: WebContents) => void;
  browser: BrowserConfig;
  // Debug-only handles, consumed by `./debug-snapshot.ts`. Read-only by
  // convention; do not mutate the returned map from outside the manager.
  getDebugEntries: () => ReadonlyMap<BrowserTargetId, BrowserEntry>;
  // Every recorded target and whether its guest has attached yet. The renderer
  // pool mounts a guest for every id; the UI treats only attached ones as live.
  getTargets: () => BrowserGuestTarget[];
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
  // Record focus returning to any element in the host renderer.
  setHostFocus: () => void;
  teardown: () => void;
}

let managerInstance: BrowserViewManager | undefined;

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

export function createBrowserViewManager(): BrowserViewManager {
  const entries = new Map<BrowserTargetId, BrowserEntry>();
  // The app window's renderer, which mounts every guest.
  let hostContents: null | WebContents = null;
  const hostOf = (targetId: BrowserTargetId) =>
    entries.has(targetId) ? hostContents : null;
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
    publisher.publish("browser.restore-host-focus", null);
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

    wc.debugger.on("message", (_event, method, params: unknown) => {
      const current = entries.get(targetId);
      if (!current) {
        return;
      }
      if (method === "Page.downloadWillBegin") {
        captureDownloadWillBeginGuid(current, params);
      }
      for (const listener of current.eventListeners) {
        listener(method, params);
      }
    });

    wc.debugger.on("detach", () => {
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
    // Mute: the page may be agent-driven and not visible to the user.
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

    guest.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        focusGuard.onNavigationStart(targetId);
        markNavigated(entry, details.url);
      }
    });
    // The blank page every guest is born on is not somewhere the page has
    // been: once it has somewhere real, that start leaves its history, so
    // back from its first page is the tab's back rather than a step onto
    // an empty page.
    guest.on("did-navigate", (_event, url) => {
      if (url !== "about:blank") {
        dropBlankStart(guest);
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
    });
    guest.on("focus", () => {
      focusGuard.onGuestFocus(targetId);
    });

    guest.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        log.error(
          `did-fail-load targetId=${entry.targetId} url=${validatedURL} errorCode=${errorCode} errorDescription=${errorDescription}`,
        );
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
      focusGuard.forgetTarget(targetId);
      handleDetach(entries, targetId);
      notifyEntriesChanged();
    });
    guest.on("render-process-gone", () => {
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
    guest.once("did-finish-load", () => {
      advanceEntry(entry, "loadSettled");
      ensureDebuggerAttached(entry);
      attachDevHooks(entry);
      entry.attach.resolve();
      // The guest is now attached; re-publish so subscribers (the UI's live
      // view) flip this target from pending to live.
      notifyEntriesChanged();
    });
    void guest.loadURL("about:blank");

    notifyDebugChange();
  }

  function bindHost(host: WebContents) {
    hostContents = host;
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

  function createTarget(
    id: TaskId,
    sessionId: StoreId.Session,
    partitionDir: AbsolutePath,
  ): Promise<{ targetId: BrowserTargetId }> {
    const targetId = encodeBrowserTargetId(id, sessionId);

    const existing = entries.get(targetId);
    if (existing) {
      // Idempotent: a single (id, sessionId) pair owns at most one guest.
      // Already bound -> reuse it; mount still in flight -> wait on it.
      if (hasGuest(existing)) {
        return Promise.resolve({ targetId });
      }
      return waitForAttach(existing).then(() => ({ targetId }));
    }

    const entry = createEntry({
      id,
      partitionDir,
      sessionId,
      targetId,
    });
    entries.set(targetId, entry);
    // Publishing the new desired set makes the renderer pool mount a guest
    // `<webview>` for this target; it attaches via will/did-attach-webview,
    // which binds it and resolves entry.attach. Removal (destroyEntry/
    // handleDetach) rejects entry.attach and republishes, so the pool disposes
    // the guest -- no explicit unmount needed.
    notifyEntriesChanged();

    return waitForAttach(entry).then(() => ({ targetId }));
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

  function listTargets(id: TaskId): Promise<BrowserTarget[]> {
    const targets: BrowserTarget[] = [];

    for (const [targetId, entry] of entries) {
      if (entry.id !== id) {
        continue;
      }

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
      return {
        id: entry.id,
        partitionDir: entry.partitionDir,
        sessionId: entry.sessionId,
      };
    },
    getTargetUrl: (targetId) => {
      const entry = entries.get(targetId);
      const guest = entry?.webContents;
      return guest && !guest.isDestroyed()
        ? guests.documentOf(guest.id, guest.mainFrame)
        : undefined;
    },
    contentBlocking: (id, blocking) => ({
      task: guests.setAdBlocking(id, blocking),
      workspace: isBlocking(),
    }),
    listTargets,
    onTargetDestroyed,
    sendCommand: (async (
      targetId: BrowserTargetId,
      method: string,
      params?: Record<string, unknown>,
    ) => {
      const dispatch = () =>
        sendCommand({
          describeHost,
          ensureDebuggerAttached,
          entries,
          method,
          params,
          requestGuestFocus,
          targetId,
        });
      if (!isAgentDrivenCommand(method)) {
        return dispatch();
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

  managerInstance = {
    bindHost,
    browser,
    getDebugEntries: () => entries,
    getTargets: () =>
      [...entries.values()].map((entry) => ({
        attached: hasGuest(entry),
        generation: entry.generation,
        id: entry.targetId,
        navigated: entry.navigated,
      })),
    setEmulatedDevice,
    setGuestFocus,
    setHostFocus,
    teardown: () => {
      for (const targetId of entries.keys()) {
        destroyEntry(entries, targetId);
      }
      notifyEntriesChanged();
    },
  };
  return managerInstance;
}

export function getBrowserViewManager(): BrowserViewManager | undefined {
  return managerInstance;
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

// Single notify for any change to the entry set: refresh the debug snapshot and
// publish the new desired-targets set so the renderer pool reconciles its
// guests. Called at every add (createTarget) and removal (destroyEntry /
// handleDetach) site.
function notifyEntriesChanged() {
  notifyDebugChange();
  publisher.publish("browser.targets-changed", null);
}
