import { openExternal } from "@/electron-main/lib/open-external";
import { publisher } from "@/electron-main/rpc/publisher";
import { sendTabCommand } from "@/electron-main/tabs/tab-command";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { APP_URL, SUPPORT_URL } from "@instrument-org/shared";
import { app, type MenuItemConstructorOptions } from "electron";

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
      {
        accelerator: "CmdOrCtrl+,",
        click: () => {
          sendTabCommand({ type: "openSettings" });
        },
        label: "Settings...",
      },
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
        {
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            // The whole tabbed app is one web contents now, so this reloads it.
            getMainWindow()?.webContents.reload();
          },
          label: "Reload All Web Views",
        },
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

export function createHelpMenu(): MenuItemConstructorOptions {
  return {
    label: "Help",
    role: "help" as const,
    submenu: [
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
