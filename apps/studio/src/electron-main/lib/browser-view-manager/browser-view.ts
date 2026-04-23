import { type ProjectSubdomain } from "@instrument-org/workspace/electron";
import { type Session, WebContentsView } from "electron";

export function createBrowserView({
  session,
}: {
  session: Session;
  subdomain: ProjectSubdomain;
}): {
  destroyView: () => void;
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

  const destroyView = () => {
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.close();
    }
  };

  return { destroyView, view };
}
