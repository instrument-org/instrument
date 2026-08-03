import "./styles/globals.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
import { MainWindow } from "./components/main-window";
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

  // The main window hosts the whole tabbed app in this one web contents
  // (MainWindow). The onboarding web contents keeps using the single-router App.
  const isMainWindow = window.api.windowType === "main";
  root.render(isMainWindow ? <MainWindow /> : <App />);

  if (isMainWindow) {
    // Subscribe the browser webview pool to main-process mount/unmount
    // commands for the lifetime of the main-window renderer.
    initBrowserPool();
    // Only the main window has tabs and app-wide modals to drive.
    initStudioDrive();
  }
}
