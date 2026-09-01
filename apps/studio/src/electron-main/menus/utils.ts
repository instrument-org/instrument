import { getMainLogFilePath } from "@/electron-main/lib/electron-logger";
import { openExternal } from "@/electron-main/lib/open-external";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { APP_URL, BUG_REPORT_URL, SUPPORT_URL } from "@instrument-org/shared";
import { app, type MenuItemConstructorOptions, shell } from "electron";

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
        shortcutMenuItem("reloadApp"),
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
      {
        click: () => {
          void openExternal(BUG_REPORT_URL);
        },
        label: "Report a Bug",
      },
      { type: "separator" as const },
      {
        // Revealed rather than opened, because the reason to want it is a
        // request to send it somewhere. Separated from the three items above
        // for the same reason they are grouped: those leave for a browser and
        // this one does not.
        //
        // The file is written from boot in any packaged build, so it is there
        // by the time this menu can be opened. In development the file
        // transport is off and this reveals nothing.
        click: () => {
          shell.showItemInFolder(getMainLogFilePath());
        },
        label: "Show Log File",
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
