import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { openOrchestratorWindow } from "@/electron-main/windows/orchestrator";
import { z } from "zod";

/**
 * Opens the orchestrator window, or focuses it. The Developer menu item does
 * the same; this is the route a script or a button in the app reaches it by.
 */
const openWindow = base.output(z.void()).handler(() => {
  openOrchestratorWindow();
});

const events = {
  /** Back and forward asked by a swipe or a thumb button, for the window's router. */
  navigate: base.handler(async function* ({ signal }) {
    for await (const direction of publisher.subscribe("orchestrator.navigate", {
      signal,
    })) {
      yield direction;
    }
  }),
};

export const orchestrator = {
  events,
  openWindow,
};
