import { sendAppCommand } from "@/electron-main/app-command";
import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { zoomIn, zoomOut } from "@/electron-main/windows/main/controls";
import { type MenuItemConstructorOptions } from "electron";

import { shortcutMenuItem } from "./shortcuts";
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
      shortcutMenuItem("newTab"),
      shortcutMenuItem("newTask"),
      { type: "separator" as const },
      shortcutMenuItem("closeTab"),
      shortcutMenuItem("reopenTab"),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    role: "viewMenu" as const,
    submenu: [
      shortcutMenuItem("commandMenu"),
      { type: "separator" as const },
      shortcutMenuItem("goBack"),
      shortcutMenuItem("goForward"),
      { type: "separator" as const },
      shortcutMenuItem("reloadPage"),
      // A focused browser guest takes keyboard focus, so Cmd+F can only reach
      // us via this native accelerator; the renderer opens the find bar in the
      // active browser panel (no-op when none is showing).
      shortcutMenuItem("findInPage"),
      { type: "separator" as const },
      shortcutMenuItem("toggleSidebar"),
      { type: "separator" as const },
      { role: "togglefullscreen" as const },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    role: "windowMenu" as const,
    submenu: [
      shortcutMenuItem("resetZoom"),
      shortcutMenuItem("zoomIn"),
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
        // Numpad "+" is a distinct key from the main-row "+", so bind it
        // explicitly; hidden so it doesn't add a second Zoom In menu row.
        accelerator: "CmdOrCtrl+numadd",
        click: () => {
          zoomIn();
        },
        label: "Zoom In",
        visible: false,
      },
      shortcutMenuItem("zoomOut"),
      {
        // Numpad "-" duplicate of Zoom Out, hidden like the numpad "+" above.
        accelerator: "CmdOrCtrl+numsub",
        click: () => {
          zoomOut();
        },
        label: "Zoom Out",
        visible: false,
      },
      { type: "separator" as const },
      shortcutMenuItem("selectNextTab"),
      shortcutMenuItem("selectPreviousTab"),
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
      // Cmd/Ctrl+1..8 jump to that tab index; hidden accelerators (no menu row)
      // behind the table's `selectTabByIndex` entry.
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
    createHelpMenu({ includeShortcutGuide: true }),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}
