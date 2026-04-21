import type { Protocol } from "devtools-protocol";

import {
  type AbsolutePath,
  type BrowserConfig,
  type BrowserTarget,
  type ProjectSubdomain,
} from "@instrument-org/workspace/electron";
import { session } from "electron";
import fs from "node:fs";

import { sendCommand } from "./cdp-bridge";
import { applyDeviceMetricsOverride } from "./device-metrics";
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

interface BrowserViewManager {
  browser: BrowserConfig;
  teardown: () => void;
}

export function createBrowserViewManager({
  developerMode = false,
}: { developerMode?: boolean } = {}): BrowserViewManager {
  const entries = new Map<string, BrowserEntry>();

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
    partitionDir: AbsolutePath,
  ): Promise<{ targetId: string }> {
    // session.fromPath requires the directory to exist (Chromium opens the
    // profile in-place). The workspace's .private dir is created lazily, so
    // ensure it exists before handing the path to Electron.
    fs.mkdirSync(partitionDir, { recursive: true });
    const ses = session.fromPath(partitionDir, { cache: true });

    const { hostWindow, view } = createHostWindow({
      developerMode,
      session: ses,
      subdomain,
    });

    // Capture id once; webContents.id becomes undefined after destruction
    // in Electron 41+ (electron/electron#50249) and would corrupt the map.
    const wc = view.webContents;
    if (!wc) {
      throw new Error("WebContentsView constructed without webContents");
    }
    const targetId = String(wc.id);

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

    const entry = createEntry({ hostWindow, subdomain, targetId, view });

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
      if (!entry.hostWindow.isDestroyed()) {
        entry.hostWindow.close();
      }
    });

    entries.set(targetId, entry);

    wc.on("destroyed", () => {
      handleDetach(entries, targetId);
    });

    // Materialize the main RenderFrame; without an initial navigation
    // CDP commands like Page.enable hang and Page.navigate has no frame.
    return new Promise((resolve) => {
      wc.once("did-finish-load", () => {
        ensureDebuggerAttached(entry);
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

  const browser: BrowserConfig = {
    closeTarget: (targetId) => {
      destroyEntry(entries, targetId);
      return Promise.resolve();
    },
    createTarget,
    listTargets,
    sendCommand: (targetId, method, params) =>
      sendCommand({
        ensureDebuggerAttached,
        entries,
        method,
        params,
        targetId,
      }),
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
    teardown: () => {
      for (const targetId of entries.keys()) {
        destroyEntry(entries, targetId);
      }
    },
  };
}
