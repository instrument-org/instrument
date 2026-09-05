import { base } from "@/electron-main/rpc/base";
import { openOrchestratorWindow } from "@/electron-main/windows/orchestrator";
import { z } from "zod";

/**
 * Opens the orchestrator window, or focuses it. The Developer menu item does
 * the same; this is the route a script or a button in the app reaches it by.
 */
const openWindow = base.output(z.void()).handler(() => {
  openOrchestratorWindow();
});

export const orchestrator = {
  openWindow,
};
