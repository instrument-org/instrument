import { publisher } from "@/electron-main/rpc/publisher";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { getOrchestratorWindow } from "@/electron-main/windows/orchestrator";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

import { createMainWindowMenu } from "./main-window";
import { createOrchestratorWindowMenu } from "./orchestrator-window";
import { createOtherWindowMenu } from "./other-window";

export function createApplicationMenu(): void {
  updateApplicationMenu();

  app.on("browser-window-focus", () => {
    updateApplicationMenu();
  });
  app.on("browser-window-blur", () => {
    updateApplicationMenu();
  });

  void publisher.subscribe("window.focus-changed", () => {
    updateApplicationMenu();
  });

  void publisher.subscribe("preferences.updated", () => {
    updateApplicationMenu();
  });
}

function getFocusedWindowType(): "main" | "orchestrator" | "other" | null {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    return null;
  }

  if (focusedWindow === getMainWindow()) {
    return "main";
  }
  if (focusedWindow === getOrchestratorWindow()) {
    return "orchestrator";
  }
  return "other";
}

function updateApplicationMenu(): void {
  const focusedWindowType = getFocusedWindowType();

  const template: MenuItemConstructorOptions[] =
    focusedWindowType === "other"
      ? createOtherWindowMenu()
      : focusedWindowType === "orchestrator"
        ? createOrchestratorWindowMenu()
        : createMainWindowMenu();

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
