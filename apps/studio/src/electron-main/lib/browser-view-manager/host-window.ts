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

  return { fitViewToWindow, hostWindow, view };
}
