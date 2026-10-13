import { publisher } from "@/electron-main/rpc/publisher";
import { getAppWindow } from "@/electron-main/windows/app-window";
import { isSetupPending } from "@/electron-main/windows/setup-mode";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

import { createAppWindowMenu } from "./app-window";
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

/**
 * The app window's menu while it or nothing is focused: with no window
 * focused on macOS, the menu bar still belongs to the app. While onboarding
 * holds the app window, the plain menu other windows get, so nothing in it
 * reaches the app behind onboarding.
 */
function updateApplicationMenu(): void {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const template: MenuItemConstructorOptions[] = [
    ...((focusedWindow && focusedWindow !== getAppWindow()) || isSetupPending()
      ? createOtherWindowMenu()
      : createAppWindowMenu()),
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
