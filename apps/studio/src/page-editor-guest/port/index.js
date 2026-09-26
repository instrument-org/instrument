// The editor bundle's entry. Evaluated by the guest preload in its isolated
// world once the page's markup is in, and only when the load is an edit (the
// bridge is there). The preload has had the observer on since document start.
import { startEditor } from "./editor.js";

const bridge = globalThis.__instrumentPageEditor;
if (bridge) {
  const start = () =>
    startEditor(bridge).catch((error) => {
      console.error("[page editor]", error);
      bridge.send({
        type: "status",
        message: `The editor could not start: ${error.message}`,
        kind: "warn",
      });
    });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
