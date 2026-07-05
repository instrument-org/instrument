import { sendAppCommand } from "@/electron-main/app-command";
import { type MenuItemConstructorOptions } from "electron";

import { isDeveloperMode } from "../stores/preferences";
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

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    role: "viewMenu" as const,
    submenu: [
      { role: "reload" as const },
      { role: "forceReload" as const },
      { role: "toggleDevTools" as const },
      { type: "separator" as const },
      // Custom CSS `zoom` (not Electron's native page zoom), so onboarding shares
      // the main window's zoom mechanism and persisted level. See OnboardingZoomRoot.
      {
        accelerator: "CmdOrCtrl+0",
        click: () => {
          sendAppCommand({ type: "zoomReset" });
        },
        label: "Actual Size",
      },
      {
        accelerator: "CmdOrCtrl+Plus",
        click: () => {
          sendAppCommand({ type: "zoomIn" });
        },
        label: "Zoom In",
      },
      {
        // Ctrl+= is what Windows users physically press to zoom in; Electron only
        // matches CmdOrCtrl+Plus on macOS, so this hidden duplicate covers it.
        accelerator: "CmdOrCtrl+=",
        click: () => {
          sendAppCommand({ type: "zoomIn" });
        },
        label: "Zoom In",
        visible: false,
      },
      {
        // Numpad "+" is a distinct key from the main-row "+", so bind it
        // explicitly; hidden so it doesn't add a second Zoom In menu row.
        accelerator: "CmdOrCtrl+numadd",
        click: () => {
          sendAppCommand({ type: "zoomIn" });
        },
        label: "Zoom In",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+-",
        click: () => {
          sendAppCommand({ type: "zoomOut" });
        },
        label: "Zoom Out",
      },
      {
        // Numpad "-" duplicate of Zoom Out, hidden like the numpad "+" above.
        accelerator: "CmdOrCtrl+numsub",
        click: () => {
          sendAppCommand({ type: "zoomOut" });
        },
        label: "Zoom Out",
        visible: false,
      },
      { type: "separator" as const },
      { role: "togglefullscreen" as const },
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    viewMenu,
    createWindowMenu(),
    createHelpMenu(),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}
