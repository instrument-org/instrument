import { publisher } from "@/electron-main/rpc/publisher";
import { type MenuItemConstructorOptions } from "electron";

import { isDeveloperMode } from "../stores/preferences";
import { createOtherWindowViewMenu } from "./other-window";
import {
  createAppMenu,
  createDevToolsMenu,
  createEditMenu,
  createHelpMenu,
  createWindowMenu,
} from "./utils";

/**
 * The orchestrator window's menu: the other windows' menu, but with the
 * chords a browser has. Cmd+W closes the tab on screen and never the window,
 * which has tabs the user may be keeping; the window closes on Shift+Cmd+W.
 */
export function createOrchestratorWindowMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        accelerator: "CmdOrCtrl+W",
        click: () => {
          publisher.publish("orchestrator.command", "closeTab");
        },
        label: "Close Tab",
      },
      {
        accelerator: "Shift+CmdOrCtrl+T",
        click: () => {
          publisher.publish("orchestrator.command", "reopenTab");
        },
        label: "Reopen Closed Tab",
      },
      {
        accelerator: "Shift+CmdOrCtrl+W",
        label: "Close Window",
        role: "close" as const,
      },
    ],
  };

  // Cmd+1 through Cmd+8 pick a tab by place; Cmd+9 the last, as browsers do.
  const tabMenu: MenuItemConstructorOptions = {
    label: "Tabs",
    submenu: Array.from({ length: 9 }, (_, index) => ({
      accelerator: `CmdOrCtrl+${index + 1}`,
      click: () => {
        publisher.publish("orchestrator.command", {
          index: index + 1,
          type: "selectTab",
        });
      },
      label: index === 8 ? "Last Tab" : `Tab ${index + 1}`,
    })),
  };

  const historyMenu: MenuItemConstructorOptions = {
    label: "History",
    submenu: [
      {
        accelerator: "CmdOrCtrl+[",
        click: () => {
          publisher.publish("orchestrator.command", "back");
        },
        label: "Back",
      },
      {
        accelerator: "CmdOrCtrl+]",
        click: () => {
          publisher.publish("orchestrator.command", "forward");
        },
        label: "Forward",
      },
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    createOtherWindowViewMenu(),
    tabMenu,
    historyMenu,
    createWindowMenu(),
    createHelpMenu({ includeShortcutGuide: false }),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}
