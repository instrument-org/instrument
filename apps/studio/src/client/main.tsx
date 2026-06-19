import "./styles/globals.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";
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

  root.render(<App />);
}
