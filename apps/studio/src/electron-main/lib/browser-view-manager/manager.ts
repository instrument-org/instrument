import type { Protocol } from "devtools-protocol";

import {
  type AbsolutePath,
  type BrowserConfig,
  type BrowserTarget,
  type BrowserTargetId,
  encodeBrowserTargetId,
  type ProjectSubdomain,
  type StoreId,
} from "@instrument-org/workspace/electron";
import { session } from "electron";
import fs from "node:fs";
import { noop } from "radashi";

import { applyDeviceMetricsOverride } from "./device-metrics";
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
import { createHostWindow } from "./host-window";
import { log } from "./log";
import { stopScreencast } from "./screencast";

export interface BrowserViewManager {
  browser: BrowserConfig;
  // Debug-only handles, consumed by `./debug-snapshot.ts`. Read-only by
  // convention; do not mutate the returned map from outside the manager.
  developerMode: boolean;
  getDebugEntries: () => ReadonlyMap<BrowserTargetId, BrowserEntry>;
  // Debug-only: bring the host BrowserWindow to the foreground (or unhide it
  // if it was hidden by a user click on the OS close button). Returns true if
  // a window was shown, false if the entry or its window are gone.
  showHostWindow: (targetId: BrowserTargetId) => boolean;
  teardown: () => void;
}

export function createBrowserViewManager({
  developerMode = false,
  onChange,
}: {
  developerMode?: boolean;
  onChange?: () => void;
} = {}): BrowserViewManager {
  const entries = new Map<BrowserTargetId, BrowserEntry>();
  const notifyChange = () => {
    if (!onChange) {
      return;
    }
    try {
      onChange();
    } catch {
      // Listener errors must not impact the manager.
    }
  };

  function ensureDebuggerAttached(entry: BrowserEntry) {
    const wc = entry.view.webContents;
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
      // cspell:ignore RWHV
      // FP-922: Chromium's captureBeyondViewport reflows against the RWHV
      // when no Emulation override is active, breaking 100vh/sticky/parallax
      // pages. Re-apply on every top-level navigation since cross-origin
      // navigation can drop the override.
      if (method === "Page.frameNavigated") {
        const p = params as Protocol.Page.FrameNavigatedEvent;
        if (!p.frame.parentId) {
          void applyDeviceMetricsOverride(current);
        }
      }
      for (const listener of current.eventListeners) {
        listener(method, params);
      }
    });

    wc.debugger.on("detach", () => {
      handleDetach(entries, targetId);
    });

    void applyDeviceMetricsOverride(entry);
  }

  function createTarget(
    subdomain: ProjectSubdomain,
    sessionId: StoreId.Session,
    partitionDir: AbsolutePath,
  ): Promise<{ targetId: BrowserTargetId }> {
    const targetId = encodeBrowserTargetId(subdomain, sessionId);

    // Idempotent: a single (subdomain, sessionId) pair owns at most one view.
    // Sub-agents and repeat agent-browser invocations for the same session
    // hit this fast path and reuse the existing WebContentsView.
    const existing = entries.get(targetId);
    if (existing) {
      return Promise.resolve({ targetId });
    }

    // session.fromPath requires the directory to exist (Chromium opens the
    // profile in-place). The workspace's .private dir is created lazily, so
    // ensure it exists before handing the path to Electron.
    fs.mkdirSync(partitionDir, { recursive: true });
    const ses = session.fromPath(partitionDir, { cache: true });

    const { destroyHostWindow, hostWindow, view } = createHostWindow({
      developerMode,
      session: ses,
      subdomain,
    });

    const wc = view.webContents;
    if (!wc) {
      throw new Error("WebContentsView constructed without webContents");
    }

    // Mute audio because the page may be controlled by the agent and not
    // visible to the user. In the future, when the user has control of the
    // page, we can unmute it.
    wc.setAudioMuted(true);

    attachDownloadHandler({ entries, session: ses, targetId });

    wc.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        log.error(
          `did-fail-load targetId=${targetId} url=${validatedURL} errorCode=${errorCode} errorDescription=${errorDescription}`,
        );
      },
    );

    const entry = createEntry({
      hostWindow,
      partitionDir,
      sessionId,
      subdomain,
      targetId,
      view,
    });

    entry.disposers.add(() => {
      stopScreencast(entry);
    });
    entry.disposers.add(() => {
      const currentWc = entry.view.webContents;
      if (
        currentWc &&
        !currentWc.isDestroyed() &&
        currentWc.debugger.isAttached()
      ) {
        try {
          currentWc.debugger.detach();
        } catch {
          // Already detached
        }
      }
    });
    entry.disposers.add(() => {
      const currentWc = entry.view.webContents;
      if (currentWc && !currentWc.isDestroyed()) {
        currentWc.close();
      }
    });
    entry.disposers.add(() => {
      destroyHostWindow();
    });
    // Fire destruction listeners as part of the disposer chain so any reason
    // for entry removal naturally signals out (explicit close, detach,
    // render-process-gone, etc.). Drained immediately afterwards so each
    // listener fires at most once.
    entry.disposers.add(() => {
      for (const listener of entry.destructionListeners) {
        try {
          listener();
        } catch (error) {
          log.warn(
            `destruction listener threw targetId=${entry.targetId} err=${String(error)}`,
          );
        }
      }
      entry.destructionListeners.clear();
    });

    entries.set(targetId, entry);
    notifyChange();

    wc.on("destroyed", () => {
      handleDetach(entries, targetId);
      notifyChange();
    });

    // Renderer crash: today only `handleDetach` was called via the debugger
    // detach event (and only sometimes, depending on how the renderer dies).
    // Force a full entry teardown so the projectBrowser machine reaps.
    wc.on("render-process-gone", () => {
      destroyEntry(entries, targetId);
      notifyChange();
    });

    // Notify on any other entry teardown path (close, detach) so the debug
    // page sees explicit closeTarget / debugger detach without waiting for
    // the periodic heartbeat.
    entry.destructionListeners.add(() => {
      notifyChange();
    });

    // Title/URL/loading-state changes are handy in the debug view; surface
    // them on a few cheap webContents events. Each is a no-op if no listener
    // is attached.
    wc.on("page-title-updated", () => {
      notifyChange();
    });
    wc.on("did-navigate", () => {
      notifyChange();
    });
    wc.on("did-navigate-in-page", () => {
      notifyChange();
    });
    wc.on("did-start-loading", () => {
      notifyChange();
    });
    wc.on("did-stop-loading", () => {
      notifyChange();
    });

    // Materialize the main RenderFrame; without an initial navigation
    // CDP commands like Page.enable hang and Page.navigate has no frame.
    return new Promise((resolve) => {
      wc.once("did-finish-load", () => {
        ensureDebuggerAttached(entry);
        notifyChange();
        resolve({ targetId });
      });
      void wc.loadURL("about:blank");
    });
  }

  function listTargets(subdomain: ProjectSubdomain): Promise<BrowserTarget[]> {
    const targets: BrowserTarget[] = [];

    for (const [targetId, entry] of entries) {
      if (entry.subdomain !== subdomain) {
        continue;
      }

      const wc = entry.view.webContents;
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
      }),
    createTarget,
    getTargetMeta: (targetId) => {
      const entry = entries.get(targetId);
      if (!entry) {
        return null;
      }
      return {
        partitionDir: entry.partitionDir,
        sessionId: entry.sessionId,
        subdomain: entry.subdomain,
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
    subscribeEvents: (targetId, onDetach, onEvent) =>
      subscribeEvents({
        ensureDebuggerAttached,
        entries,
        onDetach,
        onEvent,
        targetId,
      }),
  };

  return {
    browser,
    developerMode,
    getDebugEntries: () => entries,
    showHostWindow: (targetId) => {
      const entry = entries.get(targetId);
      if (!entry || entry.hostWindow.isDestroyed()) {
        return false;
      }
      entry.hostWindow.show();
      entry.hostWindow.focus();
      notifyChange();
      return true;
    },
    teardown: () => {
      for (const targetId of entries.keys()) {
        destroyEntry(entries, targetId);
      }
      notifyChange();
    },
  };
}
