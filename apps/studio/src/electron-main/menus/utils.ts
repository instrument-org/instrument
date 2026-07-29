import { openExternal } from "@/electron-main/lib/open-external";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { APP_URL, SUPPORT_URL } from "@instrument-org/shared";
import { app, type MenuItemConstructorOptions } from "electron";

import { shortcutMenuItem } from "./shortcuts";

export function createAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.getName(),
    role: "appMenu" as const,
    submenu: [
      { role: "about" as const },
      {
        click: () => {
          publisher.publish("updates.trigger-check", null);
        },
        label: "Check for Updates...",
      },
      { type: "separator" },
      shortcutMenuItem("settings"),
      { type: "separator" },
      { role: "services" as const },
      { type: "separator" },
      { role: "hide" as const },
      { role: "hideOthers" as const },
      { role: "unhide" as const },
      { type: "separator" },
      { role: "quit" as const },
    ],
  };
}

export function createDevToolsMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: "🐛 Dev",
      submenu: [
        shortcutMenuItem("reloadWebViews"),
        { type: "separator" as const },
        shortcutMenuItem("themeLight"),
        shortcutMenuItem("themeDark"),
        shortcutMenuItem("themeSystem"),
        { type: "separator" as const },
        {
          label: "Browser DevTools",
          submenu: [
            {
              click: () => {
                const mainWindow = getMainWindow();
                mainWindow?.webContents.openDevTools({
                  mode: "detach",
                  title: "DevTools - Sidebar",
                });
              },
              label: "Sidebar",
            },
            {
              click: () => {
                getMainWindow()?.webContents.openDevTools({
                  mode: "right",
                  title: "DevTools - Current Tab",
                });
              },
              label: "Current Tab",
            },
          ],
        },
      ],
    },
  ];
}

export function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    role: "editMenu" as const,
  };
}

/**
 * `includeShortcutGuide` is false for windows that can't show the guide: it is
 * an app-wide modal of the main window's chrome, so offering it anywhere else
 * either does nothing or opens it in a window the user isn't looking at.
 */
export function createHelpMenu({
  includeShortcutGuide,
}: {
  includeShortcutGuide: boolean;
}): MenuItemConstructorOptions {
  return {
    label: "Help",
    role: "help" as const,
    submenu: [
      ...(includeShortcutGuide
        ? ([
            shortcutMenuItem("shortcutGuide"),
            { type: "separator" },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        click: () => {
          void openExternal(APP_URL);
        },
        label: "Learn More",
      },
      {
        click: () => {
          void openExternal(SUPPORT_URL);
        },
        label: "Share Feedback",
      },
    ],
  };
}

export function createWindowMenu(): MenuItemConstructorOptions {
  return {
    label: "Window",
    role: "windowMenu" as const,
  };
}
