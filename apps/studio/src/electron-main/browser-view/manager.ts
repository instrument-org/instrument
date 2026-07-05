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
import { session, type WebContents } from "electron";
import fs from "node:fs";
import { noop } from "radashi";

import { attachDevHooks, notifyDebugChange } from "./dev-hooks";
import { sendCommand } from "./dispatch-command";
import {
  attachDownloadHandler,
  captureDownloadWillBeginGuid,
} from "./downloads";
import {
  type BrowserEntry,
  createEntry,
  destroyEntry,
  handleDetach,
  subscribeEvents,
} from "./entry";
import { attachGuestInteractions } from "./guest-interactions";
import { log } from "./log";
import { stopScreencast } from "./screencast";

// How long createTarget waits for the renderer to mount the guest `<webview>`
// and Electron to fire `did-attach-webview`. The main-window renderer is alive
// whenever the agent runs, so attach normally completes in well under a second;
// the timeout only fires if no renderer is available to host the guest.
const ATTACH_TIMEOUT_MS = 15_000;

export interface BrowserViewManager {
  // Register the `<webview>` attach lifecycle on the main window's webContents.
  // Called once the window exists; the manager itself is created earlier.
  bindHost: (host: WebContents) => void;
  browser: BrowserConfig;
  // Debug-only handles, consumed by `./debug-snapshot.ts`. Read-only by
  // convention; do not mutate the returned map from outside the manager.
  getDebugEntries: () => ReadonlyMap<BrowserTargetId, BrowserEntry>;
  // Every recorded target and whether its guest has attached yet. The renderer
  // pool mounts a guest for every id; the UI treats only attached ones as live.
  getTargets: () => BrowserGuestTarget[];
  // If a browser guest has focus, navigate its own history and return true.
  // Lets keyboard back/forward target the focused guest instead of the tab
  // (mouse buttons are handled by the guest's own app-command).
  navigateFocusedGuest: (direction: "back" | "forward") => boolean;
  // Record renderer-reported DOM focus/blur on a guest's `<webview>` element.
  // `webContents.isFocused()` is unreliable for `<webview>` guests (it can get
  // stuck `true` after focus moves to a plain host-page element), so
  // navigateFocusedGuest/zoomFocusedGuest trust this instead.
  setGuestFocus: (targetId: BrowserTargetId, focused: boolean) => void;
  teardown: () => void;
  // If a browser guest has focus, zoom its own web content and return true.
  // Lets keyboard Cmd+/-/0 target the focused guest instead of the main window
  // (main-window zoom is CSS-only and never reaches the guest's webContents).
  zoomFocusedGuest: (direction: "in" | "out" | "reset") => boolean;
}

let managerInstance: BrowserViewManager | undefined;

export function createBrowserViewManager(): BrowserViewManager {
  const entries = new Map<BrowserTargetId, BrowserEntry>();
  // FIFO of target ids accepted in `will-attach-webview`, drained in
  // `did-attach-webview` (Electron pairs the two events in order).
  const pendingAttachQueue: BrowserTargetId[] = [];
  // The guest the renderer last reported real DOM focus on (see setGuestFocus).
  let focusedTargetId: BrowserTargetId | null = null;

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

    // Block all popup windows. Agent-controlled guests must never spawn new
    // windows via window.open / target=_blank / link[target].
    guest.setWindowOpenHandler(() => ({ action: "deny" }));
    // Mute: the page may be agent-driven and not visible to the user.
    guest.setAudioMuted(true);
    // Keep producing frames while only in paint-host mode, so CDP capture and
    // Input.dispatch keep working when no tab is showing the guest.
    guest.setBackgroundThrottling(false);

    // Mouse thumb-button navigation + right-click menu so the user can drive it.
    attachGuestInteractions(guest);

    attachDownloadHandler({
      entries,
      session: guest.session,
      targetId: entry.targetId,
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
        if (errorCode !== -3 && !entry.attach.settled) {
          ensureDebuggerAttached(entry);
          entry.attach.resolve();
          notifyEntriesChanged();
        }
      },
    );

    guest.on("destroyed", () => {
      handleDetach(entries, entry.targetId);
      notifyEntriesChanged();
    });
    guest.on("render-process-gone", () => {
      destroyEntry(entries, entry.targetId);
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
    host.on("will-attach-webview", (event, webPreferences, params) => {
      const targetId = targetIdFromPartition(params.partition);
      if (!targetId) {
        // Not one of ours; leave other webviews alone.
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
      if (entry.webContents && !entry.webContents.isDestroyed()) {
        // Already bound to a live guest: a second attach for the same id would
        // rebind and orphan the first guest's debugger. Reject it.
        log.warn(
          `rejected browser webview attach (already bound) targetId=${targetId}`,
        );
        event.preventDefault();
        return;
      }

      // The trick that preserves per-task isolation: override the guest session
      // with our path-based profile. When both `session` and `partition` are
      // set, Electron prefers `session`.
      webPreferences.session = sessionForEntry(entry);
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

      pendingAttachQueue.push(entry.targetId);
    });

    host.on("did-attach-webview", (_event, guest) => {
      const targetId = pendingAttachQueue.shift();
      if (!targetId) {
        return;
      }
      const entry = entries.get(targetId);
      if (!entry) {
        return;
      }
      if (entry.webContents && !entry.webContents.isDestroyed()) {
        // Already bound (will-attach should have rejected this); don't rebind
        // and stack a second set of disposers on the entry.
        log.warn(`ignored duplicate did-attach-webview targetId=${targetId}`);
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
      if (existing.webContents && !existing.webContents.isDestroyed()) {
        return Promise.resolve({ targetId });
      }
      return waitForAttach(existing).then(() => ({ targetId }));
    }

    const entry = createEntry({ id, partitionDir, sessionId, targetId });
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
        if (!entry.attach.settled && !entry.webContents) {
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
    captureScreenshot: async (targetId) => {
      const entry = entries.get(targetId);
      if (!entry) {
        return;
      }
      const wc = entry.webContents;
      if (!wc || wc.isDestroyed()) {
        return;
      }
      const url = wc.getURL();
      if (!url || url === "about:blank") {
        return;
      }
      let image: Electron.NativeImage;
      try {
        // capturePage can hang on Windows if the background view is occluded
        // and Chromium has not produced a compositor frame yet. Observation
        // screenshots should never block the command pipeline.
        const CAPTURE_TIMEOUT_MS = 5000;
        image = await Promise.race([
          wc.capturePage(),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error("capturePage timed out"));
            }, CAPTURE_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        // Transient Chromium compositor failure (e.g. UnknownVizError) or
        // timeout -- not actionable.
        log.warn(
          `captureScreenshot failed targetId=${targetId} err=${String(error)}`,
        );
        return;
      }
      if (image.isEmpty()) {
        return;
      }
      const MAX_WIDTH = 800; // Aiming for <200KB encoded size.
      const { width } = image.getSize();
      const resized =
        width > MAX_WIDTH ? image.resize({ width: MAX_WIDTH }) : image;
      return resized.toJPEG(85);
    },
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
    listTargets,
    onTargetDestroyed,
    sendCommand: ((
      targetId: BrowserTargetId,
      method: string,
      params?: Record<string, unknown>,
    ) =>
      sendCommand({
        ensureDebuggerAttached,
        entries,
        method,
        params,
        targetId,
      })) satisfies BrowserConfig["sendCommand"],
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

  function focusedGuestWebContents(): null | WebContents {
    const entry = focusedTargetId && entries.get(focusedTargetId);
    const wc = entry?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  function navigateFocusedGuest(direction: "back" | "forward"): boolean {
    const wc = focusedGuestWebContents();
    if (!wc) {
      return false;
    }
    navigateGuest(wc, direction);
    return true;
  }

  function setGuestFocus(targetId: BrowserTargetId, focused: boolean) {
    if (focused) {
      focusedTargetId = targetId;
    } else if (focusedTargetId === targetId) {
      focusedTargetId = null;
    }
  }

  function zoomFocusedGuest(direction: "in" | "out" | "reset"): boolean {
    const wc = focusedGuestWebContents();
    if (!wc) {
      return false;
    }
    zoomGuest(wc, direction);
    return true;
  }

  managerInstance = {
    bindHost,
    browser,
    getDebugEntries: () => entries,
    getTargets: () =>
      [...entries.values()].map((entry) => ({
        attached: Boolean(
          entry.webContents && !entry.webContents.isDestroyed(),
        ),
        generation: entry.generation,
        id: entry.targetId,
      })),
    navigateFocusedGuest,
    setGuestFocus,
    teardown: () => {
      for (const targetId of entries.keys()) {
        destroyEntry(entries, targetId);
      }
      notifyEntriesChanged();
    },
    zoomFocusedGuest,
  };
  return managerInstance;
}

export function getBrowserViewManager(): BrowserViewManager | undefined {
  return managerInstance;
}

function navigateGuest(wc: WebContents, direction: "back" | "forward") {
  if (wc.isDestroyed()) {
    return;
  }
  const history = wc.navigationHistory;
  if (direction === "back" && history.canGoBack()) {
    history.goBack();
  } else if (direction === "forward" && history.canGoForward()) {
    history.goForward();
  }
}

// Single notify for any change to the entry set: refresh the debug snapshot and
// publish the new desired-targets set so the renderer pool reconciles its
// guests. Called at every add (createTarget) and removal (destroyEntry /
// handleDetach) site.
function notifyEntriesChanged() {
  notifyDebugChange();
  publisher.publish("browser.targets-changed", null);
}

// session.fromPath requires the directory to exist (Chromium opens the profile
// in-place). The workspace's .private dir is created lazily, so ensure it
// exists before handing the path to Electron.
function sessionForEntry(entry: BrowserEntry) {
  fs.mkdirSync(entry.partitionDir, { recursive: true });
  const guestSession = session.fromPath(entry.partitionDir, { cache: true });
  // Electron auto-approves every permission request (camera, mic, geolocation,
  // notifications, ...) when no handler is set. There's no browser chrome here
  // to show a native prompt, so deny everything rather than silently granting
  // it to whatever site the guest navigates to.
  guestSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  guestSession.setPermissionCheckHandler(() => false);
  return guestSession;
}

function zoomGuest(wc: WebContents, direction: "in" | "out" | "reset") {
  if (wc.isDestroyed()) {
    return;
  }
  if (direction === "reset") {
    wc.setZoomLevel(0);
  } else if (direction === "in") {
    wc.setZoomLevel(wc.getZoomLevel() + 0.5);
  } else {
    wc.setZoomLevel(wc.getZoomLevel() - 0.5);
  }
}
