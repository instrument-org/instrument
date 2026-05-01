import "./styles/app.css";

import ReactDOM, { type Root } from "react-dom/client";

import { App } from "./app";

declare global {
  var __studioRoot: Root | undefined;
}

const rootElement = document.querySelector("#root");

if (rootElement) {
  let root = globalThis.__studioRoot;
  if (!root) {
    root = ReactDOM.createRoot(rootElement);
    globalThis.__studioRoot = root;
  }

  root.render(<App />);
}
