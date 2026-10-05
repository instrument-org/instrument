import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { sendAppCommand } from "@/electron-main/app-command";
import { type AppCommand } from "@/shared/app-command";
import { resolveAccelerator } from "@/shared/shortcuts";
import { WINDOW_MENU_SHORTCUTS } from "@/shared/window-shortcuts";
import { type MenuItemConstructorOptions } from "electron";

import {
  createAppMenu,
  createDevToolsMenu,
  createEditMenu,
  createHelpMenu,
  createWindowMenu,
} from "./utils";

export function createOtherWindowMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        accelerator: "CmdOrCtrl+W",
        label: "Close Window",
        role: "close" as const,
      },
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    createOtherWindowViewMenu(),
    createWindowMenu(),
    createHelpMenu(),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}

/**
 * The View menu of a window that is not the main one: reload, dev tools, and
 * the app's own zoom. `zoom` is where a zoom chord goes: by default to the
 * app's own zoom in every window, which the app window replaces with its
 * window command, since there a chord can mean the page holding the keyboard
 * instead (page-chords.ts).
 */
export function createOtherWindowViewMenu({
  zoom = (type) => {
    sendAppCommand({ type });
  },
}: {
  zoom?: (type: AppCommand["type"]) => void;
} = {}): MenuItemConstructorOptions {
  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    role: "viewMenu" as const,
    submenu: [
      { role: "reload" as const },
      { role: "forceReload" as const },
      { role: "toggleDevTools" as const },
      { type: "separator" as const },
      // Custom CSS `zoom` (not Electron's native page zoom), so these windows
      // share the app's zoom mechanism and persisted level. See
      // OnboardingZoomRoot. Rendered out of the app's own zoom, the app
      // leaves embedded web content untouched and independent of it.
      {
        ...WINDOW_MENU_SHORTCUTS.actualSize,
        click: () => {
          zoom("zoomReset");
        },
      },
      {
        ...WINDOW_MENU_SHORTCUTS.zoomIn,
        click: () => {
          zoom("zoomIn");
        },
      },
      {
        // Ctrl+= is what Windows users physically press to zoom in; Electron only
        // matches CmdOrCtrl+Plus on macOS, so this hidden duplicate covers it.
        accelerator: "CmdOrCtrl+=",
        click: () => {
          zoom("zoomIn");
        },
        label: "Zoom In",
        visible: false,
      },
      {
        // Numpad "+" is a distinct key from the main-row "+", so bind it
        // explicitly; hidden so it doesn't add a second Zoom In menu row.
        accelerator: "CmdOrCtrl+numadd",
        click: () => {
          zoom("zoomIn");
        },
        label: "Zoom In",
        visible: false,
      },
      {
        ...WINDOW_MENU_SHORTCUTS.zoomOut,
        click: () => {
          zoom("zoomOut");
        },
      },
      {
        // Numpad "-" duplicate of Zoom Out, hidden like the numpad "+" above.
        accelerator: "CmdOrCtrl+numsub",
        click: () => {
          zoom("zoomOut");
        },
        label: "Zoom Out",
        visible: false,
      },
      { type: "separator" as const },
      {
        accelerator: resolveAccelerator(
          WINDOW_MENU_SHORTCUTS.toggleFullScreen.accelerator,
          { isMac: process.platform === "darwin" },
        ),
        role: "togglefullscreen" as const,
      },
    ],
  };

  return viewMenu;
}
