import { type ProjectSubdomain } from "@instrument-org/workspace/electron";
import { BrowserWindow, type Session, WebContentsView } from "electron";

import {
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./device-metrics";

export function createHostWindow({
  developerMode,
  session,
  subdomain,
}: {
  developerMode: boolean;
  session: Session;
  subdomain: ProjectSubdomain;
}): {
  destroyHostWindow: () => void;
  fitViewToWindow: () => void;
  hostWindow: BrowserWindow;
  view: WebContentsView;
} {
  // Defaults are pinned explicitly to guard against a future Electron
  // default flip silently weakening this agent-controlled browsing context.
  const view = new WebContentsView({
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      experimentalFeatures: false,
      nodeIntegration: false,
      sandbox: true,
      session,
      webSecurity: true,
    },
  });

  // cspell:ignore RWHV
  // Real BrowserWindow gives the view actual on-screen bounds; we still
  // apply Emulation.setDeviceMetricsOverride below to decouple Blink's
  // viewport from the RWHV so captureBeyondViewport reflows correctly
  // (FP-922) without resizing the host window during capture.
  const hostWindow = new BrowserWindow({
    height: DEFAULT_VIEWPORT_HEIGHT,
    show: developerMode,
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

  // The host window only exists for developers to peek at agent-controlled
  // browsing. If the user clicks the OS close button we hide the window
  // instead of destroying it, so the debug page can re-show it later without
  // having to re-create the WebContentsView. Real teardown goes through
  // `destroyHostWindow` (called from the entry's disposer chain).
  let allowClose = false;
  hostWindow.on("close", (event) => {
    if (allowClose || hostWindow.isDestroyed()) {
      return;
    }
    event.preventDefault();
    hostWindow.hide();
  });

  const destroyHostWindow = () => {
    if (hostWindow.isDestroyed()) {
      return;
    }
    allowClose = true;
    hostWindow.close();
  };

  return { destroyHostWindow, fitViewToWindow, hostWindow, view };
}
