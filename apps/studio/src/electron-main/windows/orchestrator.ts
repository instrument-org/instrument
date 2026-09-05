import { createContextMenu } from "@/electron-main/lib/context-menu";
import { guardNavigation } from "@/electron-main/lib/guard-navigation";
import { loadWindowURL } from "@/electron-main/lib/load-window-url";
import { openExternal } from "@/electron-main/lib/open-external";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import { studioURL } from "@/electron-main/lib/urls";
import { publisher } from "@/electron-main/rpc/publisher";
import { BrowserWindow } from "electron";
import path from "node:path";

const ORCHESTRATOR_WIDTH = 1240;
const ORCHESTRATOR_HEIGHT = 840;

let orchestratorWindow: BrowserWindow | null = null;

/**
 * The window where the user talks to the orchestrator: one conversation and
 * the tasks it created beneath. A second window on the same renderer bundle,
 * the way the onboarding window is, so the current app is left as it is. Its
 * tasks run in the main window's process and browser pool, so this window
 * needs the main one open beside it.
 */
export function openOrchestratorWindow(): BrowserWindow {
  if (orchestratorWindow && !orchestratorWindow.isDestroyed()) {
    orchestratorWindow.focus();
    return orchestratorWindow;
  }

  orchestratorWindow = new BrowserWindow({
    backgroundColor: getBackgroundColor(),
    height: ORCHESTRATOR_HEIGHT,
    minHeight: 520,
    minWidth: 900,
    show: false,
    title: "Instrument",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      additionalArguments: ["--windowType=orchestrator"],
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
    },
    width: ORCHESTRATOR_WIDTH,
  });

  orchestratorWindow.once("ready-to-show", () => {
    orchestratorWindow?.show();
  });

  orchestratorWindow.on("closed", () => {
    orchestratorWindow = null;
    publisher.publish("window.focus-changed", null);
  });

  orchestratorWindow.on("focus", () => {
    publisher.publish("window.focus-changed", null);
  });

  orchestratorWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  guardNavigation(orchestratorWindow.webContents);

  loadWindowURL(orchestratorWindow.webContents, studioURL("/orchestrator/"));

  createContextMenu({ browserWindow: orchestratorWindow });

  return orchestratorWindow;
}

export function updateOrchestratorWindowBackgroundColor() {
  if (orchestratorWindow && !orchestratorWindow.isDestroyed()) {
    orchestratorWindow.setBackgroundColor(getBackgroundColor());
  }
}
