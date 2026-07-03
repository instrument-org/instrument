import "./styles/globals.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
import { MainWindow } from "./components/main-window";
import { initAgentBrowserPool } from "./lib/agent-browser-pool";
import { applyInitialTheme } from "./lib/initial-theme";

declare global {
  var __studioRoot: Root | undefined;
}

// Apply the theme class before React mounts to avoid a light-mode flash.
applyInitialTheme();

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
    // Subscribe the agent-browser webview pool to main-process mount/unmount
    // commands for the lifetime of the main-window renderer.
    initAgentBrowserPool();
  }
}
