import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { type MenuItemConstructorOptions } from "electron";

import { hiddenShortcutItems, shortcutMenuItem } from "./shortcuts";
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
      shortcutMenuItem("toggleTaskPane"),
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
      ...hiddenShortcutItems("zoomIn"),
      shortcutMenuItem("zoomOut"),
      ...hiddenShortcutItems("zoomOut"),
      { type: "separator" as const },
      shortcutMenuItem("selectNextTab"),
      shortcutMenuItem("selectPreviousTab"),
      ...hiddenShortcutItems("selectNextTab"),
      ...hiddenShortcutItems("selectPreviousTab"),
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
      // Cmd/Ctrl+1..8 jump to that tab index, Cmd/Ctrl+9 to the last; both draw
      // no menu row, so the whole set arrives as hidden accelerators.
      ...hiddenShortcutItems("selectTabByIndex"),
      ...hiddenShortcutItems("selectLastTab"),
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
