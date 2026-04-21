import { publisher } from "@/electron-main/rpc/publisher";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { getSettingsWindow } from "@/electron-main/windows/settings";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

import { createMainWindowMenu } from "./main-window";
import { createOtherWindowMenu } from "./other-window";
import { createSettingsWindowMenu } from "./settings-window";

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

  void publisher.subscribe("sidebar.updated", () => {
    updateApplicationMenu();
  });
}

function getFocusedWindowType(): "main" | "other" | "settings" | null {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    return null;
  }

  if (focusedWindow === getSettingsWindow()) {
    return "settings";
  }
  if (focusedWindow === getMainWindow()) {
    return "main";
  }
  return "other";
}

function updateApplicationMenu(): void {
  const focusedWindowType = getFocusedWindowType();

  let template: MenuItemConstructorOptions[];
  switch (focusedWindowType) {
    case "other": {
      template = createOtherWindowMenu();
      break;
    }
    case "settings": {
      template = createSettingsWindowMenu();
      break;
    }
    default: {
      template = createMainWindowMenu();
    }
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
