import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { sendAppCommand } from "@/electron-main/tabs/tab-command";
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
          sendAppCommand({
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
          sendAppCommand({ appPath: "/new-tab", type: "navigate" });
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
          // useAppCommands + blockingModalCountAtom), so open modals stay put.
          sendAppCommand({ type: "close" });
        },
        label: "Close Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+T",
        click: () => {
          sendAppCommand({ type: "reopen" });
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
          sendAppCommand({ type: "toggleCommandMenu" });
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
          sendAppCommand({ type: "reload" });
        },
        label: "Reload Page",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+B",
        click: () => {
          sendAppCommand({ type: "toggleSidebar" });
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
          // Main-window UI zoom, applied as CSS `zoom` in the renderer; embedded
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
          sendAppCommand({ type: "selectNext" });
        },
        label: "Show Next Tab",
      },
      {
        accelerator: "Ctrl+Shift+Tab",
        click: () => {
          sendAppCommand({ type: "selectPrevious" });
        },
        label: "Show Previous Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+]",
        click: () => {
          sendAppCommand({ type: "selectNext" });
        },
        label: "Show Next Tab",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+Shift+[",
        click: () => {
          sendAppCommand({ type: "selectPrevious" });
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
      // Cmd/Ctrl+1..8 jump to that tab index; hidden accelerators (no menu row).
      ...Array.from(
        { length: 8 },
        (_, i): MenuItemConstructorOptions => ({
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => {
            sendAppCommand({ index: i, type: "selectByIndex" });
          },
          label: `Switch to Tab ${i + 1}`,
          visible: false,
        }),
      ),
      {
        accelerator: "CmdOrCtrl+9",
        click: () => {
          sendAppCommand({ type: "selectLast" });
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
