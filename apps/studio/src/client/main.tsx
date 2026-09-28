import "./styles/globals.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
import { FileSystemIconSpriteSheet } from "./components/extend/file-system";
import { MainWindow } from "./components/main-window";
import { OrchestratorWindow } from "./components/orchestrator/orchestrator-window";
import { initBrowserDownloadNotices } from "./lib/browser-download-notices";
import { initBrowserNavigationNotices } from "./lib/browser-navigation-notices";
import { initBrowserPool } from "./lib/browser-pool";
import { initDebugRpcBridge } from "./lib/debug-rpc-bridge";
import { initRendererLogForwarding } from "./lib/forward-renderer-logs";
import { initOrchestratorDrive } from "./lib/orchestrator-drive";
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
  // (MainWindow), and the 2.0 window its own (OrchestratorWindow). The
  // onboarding web contents keeps using the single-router App.
  const isMainWindow = window.api.windowType === "main";
  // Beside either root, the file browser's own type icons, drawn by
  // reference: a file named anywhere in any window (a reply's file chips, a
  // thread's marks) wears the same colored mark it has in the computer view.
  root.render(
    <>
      <FileSystemIconSpriteSheet />
      {isMainWindow ? (
        <MainWindow />
      ) : window.api.windowType === "orchestrator" ? (
        <OrchestratorWindow />
      ) : (
        <App />
      )}
    </>,
  );

  if (isMainWindow || window.api.windowType === "orchestrator") {
    // Subscribe the browser webview pool to main-process mount/unmount
    // commands for the lifetime of the renderer. Both windows host browser
    // guests: a task's browser in the main window, the orchestrator's tabs in
    // its own.
    initBrowserPool();
    initBrowserDownloadNotices();
    initBrowserNavigationNotices();
  }
  if (isMainWindow) {
    // The main window's tabs and app-wide modals, for driving scripts.
    initStudioDrive();
  } else if (window.api.windowType === "orchestrator") {
    // The 2.0 window's tabs, for the same scripts.
    initOrchestratorDrive();
  }
}
