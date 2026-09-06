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
  /** What a swipe, a thumb button, or a menu chord asked of the window. */
  command: base.handler(async function* ({ signal }) {
    for await (const command of publisher.subscribe("orchestrator.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

export const orchestrator = {
  events,
  openWindow,
};
