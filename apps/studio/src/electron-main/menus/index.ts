import { isSetupUp } from "@/electron-main/lib/setup-state";
import { publisher } from "@/electron-main/rpc/publisher";
import { getAppWindow } from "@/electron-main/windows/app-window";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

import { createAppWindowMenu } from "./app-window";
import { createOtherWindowMenu } from "./other-window";
import { setMenuUpdateReady } from "./utils";

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

  void publisher.subscribe("setup.updated", () => {
    updateApplicationMenu();
  });

  void publisher.subscribe("updates.status", ({ status }) => {
    if (setMenuUpdateReady(status.type === "downloaded")) {
      updateApplicationMenu();
    }
  });
}

/**
 * The app window's menu while it or nothing is focused: with no window
 * focused on macOS, the menu bar still belongs to the app. While setup is up
 * the app behind it is out of reach, so the menu is the minimal one.
 */
function updateApplicationMenu(): void {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const template: MenuItemConstructorOptions[] = [
    ...((focusedWindow && focusedWindow !== getAppWindow()) || isSetupUp()
      ? createOtherWindowMenu()
      : createAppWindowMenu()),
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
