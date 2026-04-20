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
  hostWindow: BrowserWindow;
  // Maps download URL -> GUID from Page.downloadWillBegin, consumed by will-download.
  pendingDownloadGuids: Map<string, string>;
  screencastInterval: null | ReturnType<typeof setInterval>;
  screencastSessionId: number;
  subdomain: ProjectSubdomain;
  // Captured at construction; webContents.id becomes undefined after
  // destruction in Electron 41+ (electron/electron#50249).
  targetId: string;
  view: WebContentsView;
}

// Matches a 13" MacBook viewport in Chrome (1280 CSS px wide, ~90px consumed
// by browser chrome on a 900px-tall screen).
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

  private async applyDeviceMetricsOverride(entry: BrowserEntry) {
    const wc = entry.view.webContents;
    if (!wc || wc.isDestroyed() || !wc.debugger.isAttached()) {
      return;
    }
    try {
      // Pin a deterministic CSS layout viewport independent of host window
      // size so agent layout assumptions (1280x800) hold even when the user
      // resizes the visible developer-mode window.
      await wc.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: 1,
        height: DEFAULT_VIEWPORT_HEIGHT,
        mobile: false,
        screenOrientation: { angle: 0, type: "portraitPrimary" },
        width: DEFAULT_VIEWPORT_WIDTH,
      });
    } catch (error) {
      log.warn(
        `setDeviceMetricsOverride failed targetId=${entry.targetId} err=${String(error)}`,
      );
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

    // Defaults are pinned explicitly to guard against a future Electron
    // default flip silently weakening this agent-controlled browsing context.
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

    // Capture id once; webContents.id becomes undefined after destruction
    // in Electron 41+ (electron/electron#50249) and would corrupt the map.
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

    // cspell:ignore RWHV
    // Real BrowserWindow gives the view actual on-screen bounds; we still
    // apply Emulation.setDeviceMetricsOverride below to decouple Blink's
    // viewport from the RWHV so captureBeyondViewport reflows correctly
    // (FP-922) without resizing the host window during capture.
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

    // Materialize the main RenderFrame; without an initial navigation
    // CDP commands like Page.enable hang and Page.navigate has no frame.
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
      // FP-922: Chromium's captureBeyondViewport reflows against the RWHV
      // when no Emulation override is active, breaking 100vh/sticky/parallax
      // pages. Re-apply on every top-level navigation since cross-origin
      // navigation can drop the override.
      if (method === "Page.frameNavigated") {
        const p = params as { frame?: { parentId?: string } };
        if (!p.frame?.parentId) {
          void this.applyDeviceMetricsOverride(current);
        }
      }
      for (const listener of current.eventListeners) {
        listener(method, params as unknown);
      }
    });

    wc.debugger.on("detach", () => {
      this.handleDetach(targetId);
    });

    void this.applyDeviceMetricsOverride(entry);
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

  // FP-922: agent-browser builds its full-page clip from contentSize (device
  // pixels) at scale: 1.0. Embedded in a HiDPI host window, Electron's layout
  // metrics report contentSize = dsf * cssContentSize regardless of Emulation
  // overrides (the override only affects window.devicePixelRatio, not
  // Page.getLayoutMetrics). That makes both the clip rectangle AND the
  // resulting PNG 2x too large in each axis: the document is painted in the
  // top half and the area below contentHeight is rendered as a second tiled
  // paint. Convert the clip to CSS px so it matches actual document bounds.
  // Returns the rewritten capture result, or null to fall through to the
  // default debugger.sendCommand path.
  private async rescaleFullPageScreenshotClip(
    entry: BrowserEntry,
    params: unknown,
  ): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    if (p.captureBeyondViewport !== true) {
      return null;
    }
    const clip = p.clip as
      | undefined
      | { height: number; scale?: number; width: number; x: number; y: number };
    if (!clip) {
      return null;
    }
    const wc = entry.view.webContents;
    if (!wc || wc.isDestroyed() || !wc.debugger.isAttached()) {
      return null;
    }
    try {
      const metrics = (await wc.debugger.sendCommand(
        "Page.getLayoutMetrics",
      )) as {
        contentSize?: { width: number };
        cssContentSize?: { width: number };
      };
      const dpW = metrics.contentSize?.width ?? 0;
      const cssW = metrics.cssContentSize?.width ?? 0;
      const dsf = cssW > 0 ? dpW / cssW : 1;
      if (dsf === 1) {
        return null;
      }
      const newClip = {
        height: Math.round(clip.height / dsf),
        scale: clip.scale ?? 1,
        width: Math.round(clip.width / dsf),
        x: Math.round(clip.x / dsf),
        y: Math.round(clip.y / dsf),
      };
      log.debug(
        `captureScreenshot rescale dsf=${dsf} cssW=${cssW} dpW=${dpW} ` +
          `clipIn=${JSON.stringify(clip)} clipOut=${JSON.stringify(newClip)}`,
      );
      return await wc.debugger.sendCommand("Page.captureScreenshot", {
        ...p,
        clip: newClip,
      });
    } catch (error) {
      log.warn(
        `captureScreenshot rescale failed targetId=${entry.targetId} err=${String(error)}`,
      );
      return null;
    }
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

    if (method === "Page.captureScreenshot") {
      const rescaled = await this.rescaleFullPageScreenshotClip(entry, params);
      if (rescaled) {
        return rescaled;
      }
    }

    // Electron's debugger does not implement the Browser domain. agent-browser
    // probes Browser.getWindowForTarget to discover window dimensions; return
    // a fixed stub matching our DEFAULT_VIEWPORT so callers can size relative
    // to the agent's logical viewport without hitting an error log per session.
    if (method === "Browser.getWindowForTarget") {
      return {
        bounds: {
          height: DEFAULT_VIEWPORT_HEIGHT,
          left: 0,
          top: 0,
          width: DEFAULT_VIEWPORT_WIDTH,
          windowState: "normal",
        },
        windowId: 1,
      };
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

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await entry.view.webContents?.debugger.sendCommand(
        method,
        params,
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
