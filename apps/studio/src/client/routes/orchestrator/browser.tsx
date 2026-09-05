import { useOrchestrator } from "@/client/components/orchestrator/context";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

/**
 * The browser screen. The browser itself is mounted by the layout and kept
 * across screens, so the page survives leaving and coming back; this route
 * only says it is the screen that is up, and hands it an address to open.
 */
export const Route = createFileRoute("/orchestrator/browser")({
  component: BrowserRoute,
  validateSearch: z.object({ url: z.string().optional() }),
});

function BrowserRoute() {
  const { browser } = useOrchestrator();
  const { url } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (url === undefined || browser === null) {
      return;
    }
    browser.open(url);
    // Opened once: the address leaves the route so that coming back to this
    // screen later shows the page as the user left it, not the address again.
    void navigate({ replace: true, search: {}, to: "/orchestrator/browser" });
  }, [browser, navigate, url]);

  return null;
}
