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

import { isDeveloperMode } from "../../stores/preferences";
import { createBrowserView } from "./browser-view";
import { attachDevHooks, getBaseWindow, notifyDebugChange } from "./dev-hooks";
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
import { log } from "./log";
import { stopScreencast } from "./screencast";

export interface BrowserViewManager {
  browser: BrowserConfig;
  // Debug-only handles, consumed by `./debug-snapshot.ts`. Read-only by
  // convention; do not mutate the returned map from outside the manager.
  getDebugEntries: () => ReadonlyMap<BrowserTargetId, BrowserEntry>;
  teardown: () => void;
}

export function createBrowserViewManager(): BrowserViewManager {
  const entries = new Map<BrowserTargetId, BrowserEntry>();

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
      for (const listener of current.eventListeners) {
        listener(method, params);
      }
    });

    wc.debugger.on("detach", () => {
      handleDetach(entries, targetId);
    });
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

    const { destroyView, view } = createBrowserView({
      developerMode: isDeveloperMode(),
      getBaseWindow,
      session: ses,
      subdomain,
    });

    const wc = view.webContents;
    if (!wc) {
      throw new Error("WebContentsView constructed without webContents");
    }

    // Block all popup windows. Agent-controlled views are headless and must
    // never open new BrowserWindows or WebContentsViews via window.open /
    // target=_blank / link[target] / etc.
    wc.setWindowOpenHandler(() => ({ action: "deny" }));

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
      destroyView();
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
    notifyDebugChange();

    wc.on("destroyed", () => {
      handleDetach(entries, targetId);
      notifyDebugChange();
    });

    // Renderer crash: today only `handleDetach` was called via the debugger
    // detach event (and only sometimes, depending on how the renderer dies).
    // Force a full entry teardown so the projectBrowser machine reaps.
    wc.on("render-process-gone", () => {
      destroyEntry(entries, targetId);
      notifyDebugChange();
    });

    // Materialize the main RenderFrame; without an initial navigation
    // CDP commands like Page.enable hang and Page.navigate has no frame.
    return new Promise((resolve) => {
      wc.once("did-finish-load", () => {
        ensureDebuggerAttached(entry);
        attachDevHooks(entry);
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
    captureScreenshot: async (targetId) => {
      const entry = entries.get(targetId);
      if (!entry) {
        return;
      }
      const wc = entry.view.webContents;
      if (!wc || wc.isDestroyed()) {
        return;
      }
      const url = wc.getURL();
      if (!url || url === "about:blank") {
        return;
      }
      const image = await wc.capturePage();
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
    getDebugEntries: () => entries,
    teardown: () => {
      for (const targetId of entries.keys()) {
        destroyEntry(entries, targetId);
      }
      notifyDebugChange();
    },
  };
}
