import "./styles/globals.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
import { FileSystemIconSpriteSheet } from "./components/extend/file-system";
import { AppWindow } from "./components/window/app-window";
import { initBrowserDownloadNotices } from "./lib/browser-download-notices";
import { initBrowserNavigationNotices } from "./lib/browser-navigation-notices";
import { initBrowserPool } from "./lib/browser-pool";
import { initDebugRpcBridge } from "./lib/debug-rpc-bridge";
import { initRendererLogForwarding } from "./lib/forward-renderer-logs";
import { initStudioDrive } from "./lib/studio-drive";

declare global {
  var __studioRoot: Root | undefined;
}

initDebugRpcBridge();
initRendererLogForwarding();

const rootElement = document.querySelector("#root");

if (rootElement) {
  let root = globalThis.__studioRoot;
  if (!root) {
    root = ReactDOM.createRoot(rootElement);
    globalThis.__studioRoot = root;
  }

  // The app window hosts its tabs in this one web contents
  // (AppWindow). The onboarding web contents uses the single-router
  // App.
  const isAppWindow = window.api.windowType === "app";
  // Beside either root, the file browser's own type icons, drawn by
  // reference: a file named anywhere in any window (a reply's file chips, a
  // chat's marks) wears the same colored mark it has in the computer view.
  root.render(
    <>
      <FileSystemIconSpriteSheet />
      {isAppWindow ? <AppWindow /> : <App />}
    </>,
  );

  if (isAppWindow) {
    // Subscribe the browser webview pool to main-process mount/unmount
    // commands for the lifetime of the renderer: every browser guest is
    // mounted here.
    initBrowserPool();
    initBrowserDownloadNotices();
    initBrowserNavigationNotices();
    // The window's tabs, for driving scripts.
    initStudioDrive();
  }
}
