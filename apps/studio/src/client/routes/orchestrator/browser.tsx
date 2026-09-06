import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { createFileRoute } from "@tanstack/react-router";

/**
 * The browser screen. The browser itself is mounted by the layout and kept
 * across screens, so the page survives leaving and coming back; this route
 * only says it is the screen that is up. The page on it is read at send time
 * by the layout, which holds the browser.
 */
export const Route = createFileRoute("/orchestrator/browser")({
  component: BrowserRoute,
});

function BrowserRoute() {
  useOnScreen({ screen: "browser" });
  return null;
}
