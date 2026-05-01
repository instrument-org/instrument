import { createRoot, type Root } from "react-dom/client";

import "./styles.css";
import { App } from "./app";

declare global {
  var __shimIframeRoot: Root | undefined;
}

const root = document.querySelector(`#root`);
if (root) {
  let reactRoot = globalThis.__shimIframeRoot;
  if (!reactRoot) {
    reactRoot = createRoot(root);
    globalThis.__shimIframeRoot = reactRoot;
  }

  reactRoot.render(<App />);
}
