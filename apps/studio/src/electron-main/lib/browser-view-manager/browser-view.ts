import { type ProjectSubdomain } from "@instrument-org/workspace/electron";
import { type BaseWindow, type Session, WebContentsView } from "electron";

import {
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./device-metrics";

export function createBrowserView({
  developerMode,
  getBaseWindow,
  session,
}: {
  developerMode: boolean;
  getBaseWindow: () => BaseWindow | null;
  session: Session;
  subdomain: ProjectSubdomain;
}): {
  destroyView: () => void;
  /**
   * Attach this view to a window's content view at z-index 0, hidden.
   * Idempotent for the same parent. Call with a different parent to re-host
   * (e.g. when embedding in a tab or debug panel in the future).
   */
  mountTo: (parent: BaseWindow) => void;
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

  let mounted: null | { cleanup: () => void; parent: BaseWindow } = null;

  const mountTo = (parent: BaseWindow) => {
    if (mounted?.parent === parent) {
      return;
    }
    mounted?.cleanup();

    parent.contentView.addChildView(view, 0);

    const fit = () => {
      if (parent.isDestroyed() || view.webContents?.isDestroyed()) {
        return;
      }
      const b = parent.getContentBounds();
      const width = Math.min(DEFAULT_VIEWPORT_WIDTH, Math.max(1, b.width));
      const height = Math.min(DEFAULT_VIEWPORT_HEIGHT, Math.max(1, b.height));
      view.setBounds({ height, width, x: 0, y: 0 });
    };

    parent.on("resize", fit);
    fit();
    view.setVisible(false);

    mounted = {
      cleanup: () => {
        parent.removeListener("resize", fit);
        if (!parent.isDestroyed()) {
          try {
            parent.contentView.removeChildView(view);
          } catch {
            // View may already be detached.
          }
        }
      },
      parent,
    };
  };

  // In developer mode the tab manager owns view placement entirely --
  // skip the hidden background mount so bounds and visibility start clean.
  if (!developerMode) {
    const parent = getBaseWindow();
    if (parent && !parent.isDestroyed()) {
      mountTo(parent);
    }
  }

  const destroyView = () => {
    mounted?.cleanup();
    mounted = null;
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.close();
    }
  };

  return { destroyView, mountTo, view };
}
