import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { sendShellCommand } from "@/electron-main/tabs/tab-command";
import {
  focusMainContents,
  goBack,
  goForward,
  resetZoom,
  zoomIn,
  zoomOut,
} from "@/electron-main/windows/main/controls";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { type MenuItemConstructorOptions } from "electron";

import {
  createAppMenu,
  createDevToolsMenu,
  createEditMenu,
  createHelpMenu,
} from "./utils";

export function createMainWindowMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        accelerator: "CmdOrCtrl+T",
        click: () => {
          sendShellCommand({
            appPath: "/new-tab",
            newTab: true,
            type: "navigate",
          });
        },
        label: "New Tab",
      },
      {
        accelerator: "CmdOrCtrl+N",
        click: () => {
          sendShellCommand({ appPath: "/new-tab", type: "navigate" });
        },
        label: "New Task",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+W",
        click: (_menuItem, focusedWindow) => {
          const mainWindow = getMainWindow();
          if (focusedWindow && focusedWindow !== mainWindow) {
            focusedWindow.close();
            return;
          }
          // The renderer ignores this while an app-wide modal is open (see
          // useShellCommands + blockingModalCountAtom), so open modals stay put.
          sendShellCommand({ type: "close" });
        },
        label: "Close Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+T",
        click: () => {
          sendShellCommand({ type: "reopen" });
        },
        label: "Reopen Closed Tab",
      },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    role: "viewMenu" as const,
    submenu: [
      {
        accelerator: "CmdOrCtrl+K",
        click: () => {
          sendShellCommand({ type: "toggleCommandMenu" });
          focusMainContents();
        },
        label: "Show Command Menu",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+[",
        click: () => {
          goBack();
        },
        label: "Back",
      },
      {
        accelerator: "CmdOrCtrl+]",
        click: () => {
          goForward();
        },
        label: "Forward",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+R",
        click: () => {
          sendShellCommand({ type: "reload" });
        },
        label: "Reload Page",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+B",
        click: () => {
          sendShellCommand({ type: "toggleSidebar" });
        },
        label: "Toggle Sidebar",
      },
      { type: "separator" as const },
      { role: "togglefullscreen" as const },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    role: "windowMenu" as const,
    submenu: [
      {
        accelerator: "CmdOrCtrl+0",
        click: () => {
          // Whole-shell UI zoom, applied as CSS `zoom` in the renderer; embedded
          // web content views (the agent browser) are left untouched.
          resetZoom();
        },
        label: "Actual Size",
      },
      {
        accelerator: "CmdOrCtrl+Plus",
        click: () => {
          zoomIn();
        },
        label: "Zoom In",
      },
      {
        // Ctrl+= is what Windows users physically press for zoom
        // in. Electron only matches CmdOrCtrl+Plus on macOS, so we need this
        // duplicate entry for Windows/Linux.
        accelerator: "CmdOrCtrl+=",
        click: () => {
          zoomIn();
        },
        label: "Zoom In",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+-",
        click: () => {
          zoomOut();
        },
        label: "Zoom Out",
      },
      { type: "separator" as const },
      {
        accelerator: "Ctrl+Tab",
        click: () => {
          sendShellCommand({ type: "selectNext" });
        },
        label: "Show Next Tab",
      },
      {
        accelerator: "Ctrl+Shift+Tab",
        click: () => {
          sendShellCommand({ type: "selectPrevious" });
        },
        label: "Show Previous Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+]",
        click: () => {
          sendShellCommand({ type: "selectNext" });
        },
        label: "Show Next Tab",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+Shift+[",
        click: () => {
          sendShellCommand({ type: "selectPrevious" });
        },
        label: "Show Previous Tab",
        visible: false,
      },
      { type: "separator" as const },
      { role: "minimize" as const },
      // zoom and front are macOS-only roles; silently no-ops on Windows/Linux
      ...(process.platform === "darwin"
        ? ([
            { role: "zoom" as const },
            { type: "separator" as const },
            { role: "front" as const },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        accelerator: "CmdOrCtrl+1",
        click: () => {
          sendShellCommand({ index: 0, type: "selectByIndex" });
        },
        label: "Switch to Tab 1",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+2",
        click: () => {
          sendShellCommand({ index: 1, type: "selectByIndex" });
        },
        label: "Switch to Tab 2",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+3",
        click: () => {
          sendShellCommand({ index: 2, type: "selectByIndex" });
        },
        label: "Switch to Tab 3",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+4",
        click: () => {
          sendShellCommand({ index: 3, type: "selectByIndex" });
        },
        label: "Switch to Tab 4",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+5",
        click: () => {
          sendShellCommand({ index: 4, type: "selectByIndex" });
        },
        label: "Switch to Tab 5",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+6",
        click: () => {
          sendShellCommand({ index: 5, type: "selectByIndex" });
        },
        label: "Switch to Tab 6",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+7",
        click: () => {
          sendShellCommand({ index: 6, type: "selectByIndex" });
        },
        label: "Switch to Tab 7",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+8",
        click: () => {
          sendShellCommand({ index: 7, type: "selectByIndex" });
        },
        label: "Switch to Tab 8",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+9",
        click: () => {
          sendShellCommand({ type: "selectLast" });
        },
        label: "Switch to Last Tab",
        visible: false,
      },
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    viewMenu,
    windowMenu,
    createHelpMenu(),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}
