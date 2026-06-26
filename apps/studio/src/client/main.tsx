import "./styles/globals.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
import { AppShell } from "./components/app-shell";
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
  // (AppShell). The studio-overlay and onboarding web contents keep using the
  // single-router App.
  const isMainWindow = window.api.windowType === "shell";
  root.render(isMainWindow ? <AppShell /> : <App />);
}
