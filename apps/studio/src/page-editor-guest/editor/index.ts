/**
 * The editor bundle's entry. Run by the guest preload in its isolated world
 * once the page's markup is in, and only when the load is an edit (the bridge
 * is there). The preload has had the page watch on since document start.
 */
import { startEditor } from "./start";

const bridge = window.__instrumentPageEditor;
if (bridge) {
  const start = () => {
    startEditor(bridge).catch((error: unknown) => {
      console.error("[page editor]", error);
      bridge.send({
        kind: "error",
        message: `The editor could not start: ${error instanceof Error ? error.message : String(error)}`,
        type: "status",
      });
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
