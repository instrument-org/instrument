import {
  type BrowserConfig,
  type BrowserTarget,
  type ProjectSubdomain,
} from "@instrument-org/workspace/electron";
import { BrowserWindow, session, WebContentsView } from "electron";

import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("BrowserViewManager");

const SCREENCAST_INTERVAL_MS = 100;

interface BrowserEntry {
  authorizedDownloadPath: null | string;
  detachListeners: Set<() => void>;
  eventListeners: Set<(method: string, params: unknown) => void>;
  // Host window for the WebContentsView. Always present so the view has real
  // bounds and a real compositor surface. Hidden by default; shown in
  // developer mode so the agent's browsing context is visible to the dev.
  hostWindow: BrowserWindow;
  // Maps download URL -> GUID from Page.downloadWillBegin, consumed by will-download.
  pendingDownloadGuids: Map<string, string>;
  screencastInterval: null | ReturnType<typeof setInterval>;
  screencastSessionId: number;
  subdomain: ProjectSubdomain;
  // Stable target id captured at construction. Never re-read from
  // webContents.id, which can become undefined after destruction.
  targetId: string;
  view: WebContentsView;
}

// Default viewport for agent browsing contexts. Matches a 13" MacBook viewport
// in Chrome (1280 CSS px wide, ~90px consumed by browser chrome on a 900px-tall
// screen). Used as the host window's content size so the WebContentsView has a
// real surface without needing Emulation.setDeviceMetricsOverride.
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 800;

export class BrowserViewManager {
  public get browser(): BrowserConfig {
    return {
      closeTarget: (targetId) => this.closeTarget(targetId),
      createTarget: (subdomain) => this.createTarget(subdomain),
      listTargets: (subdomain) => this.listTargets(subdomain),
      sendCommand: (targetId, method, params) =>
        this.sendCommand(targetId, method, params),
      subscribeEvents: (targetId, onDetach, onEvent) =>
        this.subscribeEvents(targetId, onDetach, onEvent),
    };
  }

  private developerMode: boolean;
  private entries = new Map<string, BrowserEntry>();

  constructor({ developerMode = false }: { developerMode?: boolean } = {}) {
    this.developerMode = developerMode;
  }

  public teardown() {
    for (const targetId of this.entries.keys()) {
      this.destroyEntry(targetId);
    }
  }

  private closeTarget(targetId: string): Promise<void> {
    this.destroyEntry(targetId);
    return Promise.resolve();
  }

  private createTarget(
    subdomain: ProjectSubdomain,
  ): Promise<{ targetId: string }> {
    const partition = `persist:browser-${subdomain}`;
    const ses = session.fromPartition(partition);

    // All current Electron defaults; pinned to guard against a future default
    // flip silently weakening this agent-controlled browsing context.
    const view = new WebContentsView({
      webPreferences: {
        allowRunningInsecureContent: false,
        contextIsolation: true,
        experimentalFeatures: false,
        nodeIntegration: false,
        sandbox: true,
        session: ses,
        webSecurity: true,
      },
    });

    // Capture the WebContents and its id once at construction. The id is stable
    // for the lifetime of the WebContents, so reading it later via
    // `view.webContents?.id` (which can be undefined after destruction in
    // Electron 41+; see electron/electron#50249) would yield the literal
    // string "undefined" and corrupt the entries map.
    const wc = view.webContents;
    if (!wc) {
      throw new Error("WebContentsView constructed without webContents");
    }
    const targetId = String(wc.id);

    // Register a single will-download handler for this session. If the agent
    // has authorized a download path via setDownloadBehavior, route the file
    // there using the GUID as filename (matching agent-browser's "allowAndName"
    // expectation), falling back to the original filename if no GUID was captured.
    ses.on("will-download", (_event, item) => {
      const entry = this.entries.get(targetId);
      if (entry?.authorizedDownloadPath) {
        const guid =
          entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
        entry.pendingDownloadGuids.delete(item.getURL());
        const filename = guid;
        item.setSavePath(`${entry.authorizedDownloadPath}/${filename}`);

        // Synthesize Page.downloadWillBegin so agent-browser's download command
        // can capture the GUID and start waiting for completion.
        for (const listener of entry.eventListeners) {
          listener("Page.downloadWillBegin", {
            frameId: targetId,
            guid,
            url: item.getURL(),
          });
        }

        item.once("done", (_doneEvent, state) => {
          const currentEntry = this.entries.get(targetId);
          if (!currentEntry) {
            return;
          }
          // Synthesize Page.downloadProgress so agent-browser resolves or errors.
          for (const listener of currentEntry.eventListeners) {
            listener("Page.downloadProgress", {
              guid,
              receivedBytes: item.getReceivedBytes(),
              state: state === "completed" ? "completed" : "canceled",
              totalBytes: item.getTotalBytes(),
            });
          }
        });
      } else {
        item.cancel();
      }
    });

    // Always host the view in a real BrowserWindow so it has actual bounds
    // and a real compositor surface. Without this we'd have to rely on
    // Emulation.setDeviceMetricsOverride, which conflicts with the override
    // Chromium applies internally during full-page screenshots (causing
    // duplicated content) and breaks subtle layout features that depend on a
    // real visual viewport (sticky positioning, lazy-load IntersectionObservers,
    // visualViewport APIs, etc.). In production the window is hidden; in
    // developer mode it's shown so the dev can see the agent's browsing context.
    const hostWindow = new BrowserWindow({
      height: DEFAULT_VIEWPORT_HEIGHT,
      show: this.developerMode,
      title: `Agent Browser [${subdomain}]`,
      width: DEFAULT_VIEWPORT_WIDTH,
    });
    hostWindow.contentView.addChildView(view);
    const fitViewToWindow = () => {
      if (hostWindow.isDestroyed()) {
        return;
      }
      const size = hostWindow.getContentSize();
      const width = size[0] ?? DEFAULT_VIEWPORT_WIDTH;
      const height = size[1] ?? DEFAULT_VIEWPORT_HEIGHT;
      view.setBounds({ height, width, x: 0, y: 0 });
    };
    fitViewToWindow();
    hostWindow.on("resize", fitViewToWindow);

    wc.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        log.error(
          `did-fail-load targetId=${targetId} url=${validatedURL} errorCode=${errorCode} errorDescription=${errorDescription}`,
        );
      },
    );

    const entry: BrowserEntry = {
      authorizedDownloadPath: null,
      detachListeners: new Set(),
      eventListeners: new Set(),
      hostWindow,
      pendingDownloadGuids: new Map(),
      screencastInterval: null,
      screencastSessionId: 0,
      subdomain,
      targetId,
      view,
    };

    this.entries.set(targetId, entry);

    wc.on("destroyed", () => {
      this.handleDetach(targetId);
    });

    // Load about:blank to properly initialize the renderer frame. Without an
    // initial navigation the WebContents has no main RenderFrame, so CDP
    // commands like Page.enable hang and Page.navigate has no frame to act on.
    // Even with the view attached to a (hidden) BrowserWindow, Electron does
    // not auto-navigate; the explicit load is what materializes the frame.
    return new Promise((resolve) => {
      wc.once("did-finish-load", () => {
        this.ensureDebuggerAttached(entry);
        resolve({ targetId });
      });
      void wc.loadURL("about:blank");
    });
  }

  private destroyEntry(targetId: string) {
    const entry = this.entries.get(targetId);
    if (!entry) {
      return;
    }

    this.stopScreencast(entry);

    const { hostWindow, view } = entry;

    if (view.webContents?.debugger.isAttached()) {
      try {
        view.webContents.debugger.detach();
      } catch {
        // Already detached
      }
    }

    if (!view.webContents?.isDestroyed()) {
      view.webContents?.close();
    }

    if (!hostWindow.isDestroyed()) {
      hostWindow.close();
    }

    this.entries.delete(targetId);
  }

  private ensureDebuggerAttached(entry: BrowserEntry) {
    const wc = entry.view.webContents;
    if (!wc || wc.isDestroyed()) {
      return;
    }
    if (wc.debugger.isAttached()) {
      return;
    }
    // Capture the targetId once; `wc.id` becomes undefined after destruction
    // in Electron 41+ (electron/electron#50249), so re-reading it inside the
    // callbacks below would yield "undefined" and miss the entry lookup.
    const targetId = entry.targetId;
    wc.debugger.attach("1.3");

    wc.debugger.on("message", (_event, method, params) => {
      const current = this.entries.get(targetId);
      if (!current) {
        return;
      }
      // Capture the GUID from Page.downloadWillBegin so will-download can
      // save with the GUID filename that agent-browser expects to find.
      if (method === "Page.downloadWillBegin") {
        const p = params as { guid?: string; url?: string };
        if (p.guid && p.url) {
          current.pendingDownloadGuids.set(p.url, p.guid);
        }
      }
      for (const listener of current.eventListeners) {
        listener(method, params as unknown);
      }
    });

    wc.debugger.on("detach", () => {
      this.handleDetach(targetId);
    });
  }

  private handleDetach(targetId: string) {
    const entry = this.entries.get(targetId);
    if (!entry) {
      return;
    }

    this.stopScreencast(entry);

    // Defensively detach the debugger. If the WebContents was closed externally
    // (crash, OS kill) the debugger may still be attached from our side; if it
    // already detached this throws and we ignore it.
    const wc = entry.view.webContents;
    if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach();
      } catch {
        // Already detached
      }
    }

    for (const listener of entry.detachListeners) {
      listener();
    }

    entry.detachListeners.clear();
    entry.eventListeners.clear();

    if (!entry.hostWindow.isDestroyed()) {
      entry.hostWindow.close();
    }

    this.entries.delete(targetId);
  }

  private listTargets(subdomain: ProjectSubdomain): Promise<BrowserTarget[]> {
    const targets: BrowserTarget[] = [];

    for (const [targetId, entry] of this.entries) {
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

  private async sendCommand(
    targetId: string,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const entry = this.entries.get(targetId);
    if (!entry) {
      log.error(
        `sendCommand: target not found targetId=${targetId} method=${method}`,
      );
      throw new Error(`Browser target not found: ${targetId}`);
    }

    this.ensureDebuggerAttached(entry);

    // Electron's debugger protocol does not expose Page.printToPDF. Use the
    // native webContents.printToPDF() API and return a CDP-compatible response.
    if (method === "Page.printToPDF") {
      const p = (params ?? {}) as Record<string, unknown>;
      try {
        const data = await entry.view.webContents?.printToPDF({
          landscape: p.landscape === true,
          preferCSSPageSize: p.preferCSSPageSize === true,
          printBackground: p.printBackground !== false,
        });
        if (!data) {
          throw new Error("webContents unavailable");
        }
        const result = { data: data.toString("base64") };
        return result;
      } catch (error) {
        log.error(
          `sendCommand error targetId=${targetId} method=${method} error=${String(error)}`,
        );
        throw error;
      }
    }

    // Electron's debugger does not expose Page.startScreencast / stopScreencast.
    // Emulate them by polling webContents.capturePage() and emitting synthetic
    // Page.screencastFrame events into the event listener set.
    if (method === "Page.startScreencast") {
      const p = (params ?? {}) as Record<string, unknown>;
      const format = typeof p.format === "string" ? p.format : "jpeg";
      const quality = typeof p.quality === "number" ? p.quality : 80;
      const maxWidth = typeof p.maxWidth === "number" ? p.maxWidth : 1280;
      const maxHeight = typeof p.maxHeight === "number" ? p.maxHeight : 720;
      this.startScreencast(entry, format, quality, maxWidth, maxHeight);
      return {};
    }

    if (method === "Page.stopScreencast") {
      this.stopScreencast(entry);
      return {};
    }

    // screencastFrameAck is a flow-control signal back to the browser; since
    // we drive the capture loop ourselves we can silently acknowledge it.
    if (method === "Page.screencastFrameAck") {
      return {};
    }

    // Electron does not support CDP browser context management. Map
    // Browser.setDownloadBehavior to the native Electron session API instead.
    if (method === "Browser.setDownloadBehavior") {
      const p = (params ?? {}) as Record<string, unknown>;
      const downloadPath =
        typeof p.downloadPath === "string" ? p.downloadPath : null;
      const behavior = typeof p.behavior === "string" ? p.behavior : "default";
      if (
        (behavior === "allow" || behavior === "allowAndName") &&
        downloadPath
      ) {
        entry.authorizedDownloadPath = downloadPath;
        entry.view.webContents?.session.setDownloadPath(downloadPath);
      } else {
        entry.authorizedDownloadPath = null;
      }
      return {};
    }

    // Known limitation: Page.captureScreenshot with captureBeyondViewport=true
    // produces stacked duplicates on Electron's on-screen WebContentsView (the
    // renderer reflows at the clip height but only the top tile paints). Use
    // Page.printToPDF or client-side stitching for full-page captures.
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await entry.view.webContents?.debugger.sendCommand(
        method,
        params as Record<string, unknown>,
      );
      return result;
    } catch (error) {
      log.error(
        `sendCommand error targetId=${targetId} method=${method} error=${String(error)}`,
      );
      throw error;
    }
  }

  private startScreencast(
    entry: BrowserEntry,
    format: string,
    quality: number,
    maxWidth: number,
    maxHeight: number,
  ) {
    this.stopScreencast(entry);
    entry.screencastSessionId += 1;
    const screencastSessionId = entry.screencastSessionId;
    const { targetId } = entry;
    let inFlight = false;

    const captureAndEmit = () => {
      // Backpressure: skip this tick if the previous capture hasn't resolved.
      // Prevents pile-up if encoding/IPC is slower than SCREENCAST_INTERVAL_MS.
      if (inFlight) {
        return;
      }
      // electron/electron#50249: webContents is undefined after destruction in Electron 41+
      const wc = entry.view.webContents;
      if (!wc || wc.isDestroyed()) {
        this.stopScreencast(entry);
        return;
      }
      inFlight = true;
      wc.capturePage({ height: maxHeight, width: maxWidth, x: 0, y: 0 })
        .then((image) => {
          // Stale: a new screencast session started, or the entry is gone, or
          // the WebContents was destroyed while the capture was pending.
          if (entry.screencastSessionId !== screencastSessionId) {
            return;
          }
          const current = entry.view.webContents;
          if (!current || current.isDestroyed()) {
            return;
          }
          const data =
            format === "png"
              ? image.toPNG().toString("base64")
              : image.toJPEG(quality).toString("base64");
          const params = {
            data,
            metadata: {
              deviceHeight: maxHeight,
              deviceWidth: maxWidth,
              offsetTop: 0,
              pageScaleFactor: 1,
              scrollOffsetX: 0,
              scrollOffsetY: 0,
              timestamp: Date.now() / 1000,
            },
            sessionId: screencastSessionId,
          };
          for (const listener of entry.eventListeners) {
            listener("Page.screencastFrame", params);
          }
        })
        .catch((error: unknown) => {
          log.warn(
            `screencast capture failed targetId=${targetId} err=${String(error)}`,
          );
        })
        .finally(() => {
          inFlight = false;
        });
    };

    entry.screencastInterval = setInterval(
      captureAndEmit,
      SCREENCAST_INTERVAL_MS,
    );
    captureAndEmit();
  }

  private stopScreencast(entry: BrowserEntry) {
    if (entry.screencastInterval !== null) {
      clearInterval(entry.screencastInterval);
      entry.screencastInterval = null;
    }
  }

  private subscribeEvents(
    targetId: string,
    onDetach: () => void,
    onEvent: (method: string, params: unknown) => void,
  ): () => void {
    const entry = this.entries.get(targetId);
    if (!entry) {
      onDetach();
      return () => {
        /* No-op */
      };
    }

    this.ensureDebuggerAttached(entry);

    entry.eventListeners.add(onEvent);
    entry.detachListeners.add(onDetach);

    return () => {
      entry.eventListeners.delete(onEvent);
      entry.detachListeners.delete(onDetach);
      // Keep the debugger attached so subsequent connections (e.g. a second
      // agent-browser invocation in the same session) can reuse the target
      // without the entry being destroyed by the detach event.
    };
  }
}
